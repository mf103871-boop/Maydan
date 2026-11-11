// Build-time only. The shipped Badeeha bank keeps everything play reads (q, a,
// alt, p, qid, topic, media with its credits, hints, grids...). Editorial
// verification metadata stays in src/data/categories for the bank tools and
// reviewers; no screen or rule reads it, and it was a third of the bank's bytes.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const INDEX = path.join(ROOT, 'src/data/categories/index.js');

export const BANK_EDITORIAL_FIELDS = Object.freeze(['sourceUrl', 'source', 'verified', 'verifiedAt', 'verification', 'difficultyTarget']);

// Only top-level question fields are dropped. A media entry's own sourceUrl,
// author and license feed the sources-and-licenses screen and stay intact.
export function shippedBankPack(pack) {
  if (!pack || typeof pack !== 'object' || !Array.isArray(pack.qs)) return pack;
  return { ...pack, qs: pack.qs.map(question => Object.fromEntries(Object.entries(question).filter(([key]) => !BANK_EDITORIAL_FIELDS.includes(key)))) };
}

// Store repeated JSON field names once per pack. Keep all values, ordering,
// question IDs and nested media credits; no text or answer is shortened.
export function packedQuestionBank(pack) {
  const keys = [], keyIds = new Map(), shapes = [], shapeIds = new Map(), ancestors = new Set();
  const encode = value => {
    if (value === null || ['string', 'boolean'].includes(typeof value)) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (!value || typeof value !== 'object' || ancestors.has(value)
      || !Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
      throw new TypeError('Question packaging requires acyclic JSON data');
    ancestors.add(value);
    let encoded;
    if (Array.isArray(value)) encoded = [1, ...value.map(encode)];
    else {
      const shape = Object.keys(value).map(key => {
        if (!keyIds.has(key)) { keyIds.set(key, keys.length); keys.push(key); }
        return keyIds.get(key);
      });
      const identity = shape.join(',');
      if (!shapeIds.has(identity)) { shapeIds.set(identity, shapes.length); shapes.push(shape); }
      encoded = [0, shapeIds.get(identity), ...Object.values(value).map(encode)];
    }
    ancestors.delete(value);
    return encoded;
  };
  const data = encode(pack);
  return { keys, shapes, data };
}

export function bankPackagingPlugin() {
  return { name: 'shipped-question-bank', setup(builder) {
    builder.onLoad({ filter: /[/\\]src[/\\]data[/\\]categories[/\\]index\.js$/, namespace: 'file' }, async args => {
      const source = await readFile(args.path, 'utf8');
      const declaration = source.match(/^export const CATS = (\[pack_[a-z0-9_,\s]+\]);\r?$/m);
      if (!declaration || path.resolve(args.path) !== path.resolve(INDEX)) throw new Error('Unexpected question index; review its compiled representation');
      return { contents: "import { unpackQuestionBank as __unpackBank } from '../packed-bank.mjs';\n"
        + source.replace(declaration[0], `export const CATS = ${declaration[1]}.map(__unpackBank);`),
      loader: 'js', resolveDir: path.dirname(args.path), watchFiles: [args.path] };
    });
    builder.onResolve({ filter: /^\.\/[a-z0-9_-]+\.json$/ }, args => {
      if (path.resolve(args.importer) !== path.resolve(INDEX)) return undefined;
      return { path: path.resolve(path.dirname(INDEX), args.path), namespace: 'packed-question-json' };
    });
    builder.onLoad({ filter: /\.json$/, namespace: 'packed-question-json' }, async args => ({
      contents: JSON.stringify(packedQuestionBank(shippedBankPack(JSON.parse(await readFile(args.path, 'utf8'))))),
      loader: 'json', watchFiles: [args.path],
    }));
    builder.onLoad({ filter: /[/\\]src[/\\]data[/\\]categories[/\\][a-z0-9_-]+\.json$/, namespace: 'file' }, async args => ({
      contents: JSON.stringify(shippedBankPack(JSON.parse(await readFile(args.path, 'utf8')))), loader: 'json',
    }));
  } };
}

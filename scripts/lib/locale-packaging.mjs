import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { shippedBankPack } from './bank-packaging.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CONTENT = path.join(ROOT, 'src/data/locales/en/index.js');
const UI = path.join(ROOT, 'src/shared/i18n/en.js');
const LOADER = path.join(ROOT, 'src/shared/locale-pack-loader.mjs');
const PREFIX = 'maydan-locale-asset:';
async function sourceData(file, name) {
  // Rebundle on every rebuild, so edits in watched JSON/dictionaries cannot be
  // hidden by Node's module cache. No runtime network or executable remote code.
  const result = await build({ entryPoints: [file], bundle: true, write: false, metafile: true, platform: 'node', format: 'esm', logLevel: 'silent' });
  const module = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
  return { data: module[name], watchFiles: Object.keys(result.metafile.inputs).map(input => path.resolve(input)) };
}
export function shippedEnglishContent(gameId, content) {
  return gameId === 'badeeha' ? content.map(shippedBankPack) : content;
}
export function localePackagingPlugin() {
  let packs = new Map();
  return { name: 'public-locale-assets', setup(builder) {
    builder.onStart(() => { packs = new Map(); });
    builder.onResolve({ filter: /^maydan-locale-asset:/ }, args => ({ path: args.path.slice(PREFIX.length), namespace: 'maydan-locale-json' }));
    builder.onLoad({ filter: /.*/, namespace: 'maydan-locale-json' }, args => {
      const pack = packs.get(args.path);
      if (!pack) throw new Error('Unknown public locale asset');
      return { contents: JSON.stringify(pack.payload), loader: 'file', watchFiles: pack.watchFiles };
    });
    const install = async (args, kind) => {
      const { data, watchFiles } = await sourceData(args.path, kind === 'ui' ? 'EN' : 'ENGLISH_CONTENT');
      const contentVersion = kind === 'ui' ? 'ui-en-v1' : 'new-en';
      const values = kind === 'ui' ? [['ui', data]] : Object.entries(data);
      const imports = [], entries = [];
      for (const [index, [id, raw]] of values.entries()) {
        if (!/^[a-z]+$/.test(id) || id === 'ersomha') throw new Error('Unsupported public locale pack');
        const body = kind === 'game' ? shippedEnglishContent(id, raw) : raw;
        const filename = `locale-en-${id}.json`;
        packs.set(filename, { payload: { schemaVersion: 1, kind, id, contentLocale: 'en', contentVersion, data: body }, watchFiles });
        imports.push(`import asset${index} from ${JSON.stringify(PREFIX + filename)};`);
        entries.push(`${JSON.stringify(id)}:{url:asset${index},kind:${JSON.stringify(kind)},contentVersion:${JSON.stringify(contentVersion)},array:${Array.isArray(body)}}`);
      }
      const base = `${imports.join('\n')}\nimport {createLocalePackLoader} from ${JSON.stringify(LOADER)};\nconst manifest={${entries.join(',')}};\n`;
      const contents = kind === 'ui'
        ? base + `export const EN={};const registry={};const load=createLocalePackLoader(manifest,registry);export const englishUiReady=()=>Object.hasOwn(registry,'ui');export async function loadEnglishUi(){const data=await load('ui','ui-en-v1');Object.assign(EN,data);return EN;}`
        : base + `export const ENGLISH_CONTENT={};const load=createLocalePackLoader(manifest,ENGLISH_CONTENT);export const hasEnglishContentPack=id=>Object.hasOwn(manifest,id);export const loadEnglishContent=(id,version='new-en')=>load(id,version);`;
      return { contents, loader: 'js', resolveDir: ROOT, watchFiles };
    };
    builder.onLoad({ filter: /[/\\]src[/\\]data[/\\]locales[/\\]en[/\\]index\.js$/, namespace: 'file' }, args => path.resolve(args.path) === path.resolve(CONTENT) ? install(args, 'game') : undefined);
    builder.onLoad({ filter: /[/\\]src[/\\]shared[/\\]i18n[/\\]en\.js$/, namespace: 'file' }, args => path.resolve(args.path) === path.resolve(UI) ? install(args, 'ui') : undefined);
  } };
}

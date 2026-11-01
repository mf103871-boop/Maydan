// Build-time only. The shipped Badeeha bank keeps everything play reads (q, a,
// alt, p, qid, topic, media with its credits, hints, grids...). Editorial
// verification metadata stays in src/data/categories for the bank tools and
// reviewers; no screen or rule reads it, and it was a third of the bank's bytes.
import { readFile } from 'node:fs/promises';

export const BANK_EDITORIAL_FIELDS = Object.freeze(['sourceUrl', 'source', 'verified', 'verifiedAt', 'verification', 'difficultyTarget']);

// Only top-level question fields are dropped. A media entry's own sourceUrl,
// author and license feed the sources-and-licenses screen and stay intact.
export function shippedBankPack(pack) {
  if (!pack || typeof pack !== 'object' || !Array.isArray(pack.qs)) return pack;
  return { ...pack, qs: pack.qs.map(question => Object.fromEntries(Object.entries(question).filter(([key]) => !BANK_EDITORIAL_FIELDS.includes(key)))) };
}

export function bankPackagingPlugin() {
  return { name: 'shipped-question-bank', setup(builder) {
    builder.onLoad({ filter: /[/\\]src[/\\]data[/\\]categories[/\\][a-z0-9_-]+\.json$/ }, async args => ({
      contents: JSON.stringify(shippedBankPack(JSON.parse(await readFile(args.path, 'utf8')))), loader: 'json',
    }));
  } };
}

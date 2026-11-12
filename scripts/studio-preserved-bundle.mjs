// Preparation only. Private Arabic modules enter an in-memory server bundle;
// no upload, credential access, remote migration or plaintext file writer exists.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { parse } from 'espree';
import { privateBankManifest } from './mafia-preserved-bundle.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const STUDIO_ARABIC_SEMANTIC_SHA256 = '3bf206a09a6baee3c5768e0a00076d6eb6fff5d79867a2afaf6fc1232898fae4';
const PRIVATE_FILE = /^server\/(?:data\/ersomha\/[a-z0-9-]+\.mjs|ersomha-content\.mjs)$/;
const ENTRYPOINTS = ['server/full-worker.mjs', 'server/worker.mjs'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const slash = value => value.replaceAll('\\', '/');

// This pure function is embedded beside the current localized loader. Legacy
// IDs, retirement and reviewed family/tier changes always come from the private
// Arabic catalog, never from the older public 1,200-entry development catalog.
export function localizePreservedBank(sourceEnglish, activeArabic, catalog, retired, crosswalk, equivalents, normalize) {
  const active = new Map(activeArabic.map(entry => [entry.id, entry]));
  const all = new Map(catalog.map(entry => [entry.id, entry]));
  const byName = new Map();
  for (const entry of catalog) for (const name of [entry.answer, ...(entry.aliases || [])]) {
    const key = normalize(name), values = byName.get(key) || [];
    if (!values.includes(entry)) values.push(entry);
    byName.set(key, values);
  }
  const result = [], seenConcepts = new Set();
  for (const candidate of sourceEnglish) {
    let legacy = all.get(candidate.id);
    if (!legacy && candidate.conceptOrigin === 'legacy-ar') legacy = catalog.find(entry => entry.conceptId === candidate.conceptId);
    if (!legacy) {
      const [, , category, tier, ordinal] = candidate.id.split('-');
      const names = [...(crosswalk[category]?.[Number(tier) - 1]?.split('|')[Number(ordinal) - 1]?.split(';') || []), ...(equivalents[candidate.answer] || [])];
      const matches = [...new Set(names.flatMap(name => byName.get(normalize(name)) || []))];
      legacy = matches.find(entry => entry.category === category && active.has(entry.id))
        || matches.find(entry => active.has(entry.id)) || matches[0];
    }
    if (legacy && (Object.hasOwn(retired, legacy.id) || !active.has(legacy.id))) continue;
    if (!legacy && candidate.conceptOrigin === 'legacy-ar') throw new Error('STUDIO_LEGACY_ID_UNMAPPED');
    const entry = legacy ? { ...candidate, conceptId: legacy.conceptId, familyId: legacy.familyId,
      category: legacy.category, difficulty: legacy.difficulty, conceptOrigin: 'legacy-ar' } : { ...candidate };
    // Two English renderings of one concept are a single history identity.
    if (seenConcepts.has(entry.conceptId)) continue;
    seenConcepts.add(entry.conceptId); result.push(Object.freeze(entry));
  }
  return Object.freeze(result);
}

export function mergePreservedEnglish(baseEnglish, activeArabic, supplement) {
  const require = (condition, code) => { if (!condition) throw new Error(code); };
  const normalize = text => text.normalize('NFKC').toLocaleLowerCase('en').trim().replace(/\s+/gu, ' ');
  const active = new Map(activeArabic.map(entry => [entry.id, entry]));
  const byConcept = new Map(activeArabic.map(entry => [entry.conceptId, entry]));
  require(supplement?.schemaVersion === 1 && supplement.contentLocale === 'en' && supplement.contentVersion === 'new-en', 'STUDIO_SUPPLEMENT_VERSION');
  require(Array.isArray(supplement.entries) && Array.isArray(supplement.equivalences || []) && Array.isArray(supplement.overrides || []), 'STUDIO_SUPPLEMENT_SHAPE');
  const checkText = entry => {
    require(typeof entry.answer === 'string' && entry.answer.trim() === entry.answer && entry.answer.length > 0 && entry.answer.length <= 160, 'STUDIO_SUPPLEMENT_ANSWER');
    require(Array.isArray(entry.aliases) && entry.aliases.length <= 24, 'STUDIO_SUPPLEMENT_ALIASES');
    require([entry.answer, ...entry.aliases].every(text => typeof text === 'string' && text.trim() === text && text.length > 0 && text.length <= 160 && !/\p{Script=Arabic}/u.test(text)), 'STUDIO_SUPPLEMENT_LANGUAGE');
    require(new Set([entry.answer, ...entry.aliases].map(normalize)).size === entry.aliases.length + 1, 'STUDIO_SUPPLEMENT_DUPLICATE_ALIAS');
  };
  const entries = baseEnglish.map(entry => ({ ...entry, aliases: [...entry.aliases] })), ids = new Set(entries.map(entry => entry.id));
  for (const entry of supplement.entries) {
    const ar = active.get(entry.id); require(ar && !ids.has(entry.id), 'STUDIO_SUPPLEMENT_ACTIVE_ID');
    require(['conceptId', 'familyId', 'category', 'difficulty'].every(key => entry[key] === ar[key]), 'STUDIO_SUPPLEMENT_IDENTITY');
    require(entry.contentLocale === 'en' && entry.conceptOrigin === 'legacy-ar', 'STUDIO_SUPPLEMENT_LOCALE'); checkText(entry);
    entries.push({ ...entry, aliases: [...entry.aliases] }); ids.add(entry.id);
  }
  const overridden = new Set();
  for (const override of supplement.overrides || []) {
    const entry = entries.find(item => item.id === override.id);
    require(entry && !overridden.has(override.id) && Object.keys(override).every(key => ['id', 'answer', 'aliases'].includes(key)), 'STUDIO_SUPPLEMENT_OVERRIDE');
    checkText(override); Object.assign(entry, { answer: override.answer, aliases: [...override.aliases] }); overridden.add(override.id);
  }
  const removed = new Set();
  for (const pair of supplement.equivalences || []) {
    const from = entries.find(entry => entry.id === pair.englishId), ar = active.get(pair.arabicId);
    const to = entries.find(entry => ar && entry.conceptId === ar.conceptId && entry.conceptOrigin === 'legacy-ar');
    require(from && to && from !== to && from.conceptOrigin === 'new-en' && !removed.has(from.id), 'STUDIO_SUPPLEMENT_EQUIVALENCE');
    const names = new Map([to.answer, ...to.aliases, from.answer, ...from.aliases].map(name => [normalize(name), name]));
    names.delete(normalize(to.answer)); to.aliases = [...names.values()]; checkText(to); removed.add(from.id);
  }
  const result = entries.filter(entry => !removed.has(entry.id));
  require(new Set(result.map(entry => entry.conceptId)).size === result.length, 'STUDIO_SUPPLEMENT_DUPLICATE_CONCEPT');
  for (const entry of result) if (entry.conceptOrigin === 'legacy-ar') {
    const ar = byConcept.get(entry.conceptId);
    require(ar && ['familyId', 'category', 'difficulty'].every(key => entry[key] === ar[key]), 'STUDIO_SUPPLEMENT_IDENTITY');
  }
  const translated = new Set(result.filter(entry => entry.conceptOrigin === 'legacy-ar').map(entry => entry.conceptId));
  const untranslatedActiveArabic = activeArabic.filter(entry => !translated.has(entry.conceptId)).length;
  require(untranslatedActiveArabic === 0, 'STUDIO_SUPPLEMENT_INCOMPLETE');
  return { entries: Object.freeze(result.map(entry => Object.freeze({ ...entry, aliases: Object.freeze(entry.aliases) }))),
    coverage: { translatedActiveArabic: activeArabic.length, untranslatedActiveArabic, englishTotal: result.length,
      additionalEnglishConcepts: result.filter(entry => entry.conceptOrigin === 'new-en').length, equivalentEnglishConceptsMerged: removed.size,
      supplementEntries: supplement.entries.length, textOverrides: overridden.size } };
}

function studioLoader(source, hasSupplement) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', range: true });
  const declared = node => (node.type === 'ExportNamedDeclaration' ? node.declaration : node)?.declarations?.map(item => item.id.name) || [];
  const first = ast.body.findIndex(node => declared(node).includes('ERSOMHA_BANK_VERSION'));
  const last = ast.body.findIndex(node => declared(node).includes('ERSOMHA_ENGLISH_BANK'));
  assert.ok(first >= 0 && last > first, 'The current localized loader bank seam is missing.');
  const bankNodes = ast.body.slice(first, last + 1);
  assert.deepEqual(bankNodes.flatMap(declared), ['ERSOMHA_BANK_VERSION', 'ERSOMHA_BANK', 'conceptIndex', 'englishDrafts', 'translatedLegacy', 'translatedNames', 'ERSOMHA_ENGLISH_BANK'], 'Review a changed localized loader before preserving private content.');
  assert.ok(bankNodes.every(node => ['ExportNamedDeclaration', 'VariableDeclaration', 'ForOfStatement'].includes(node.type)));
  const replacement = `import { ERSOMHA_BANK_VERSION, ERSOMHA_BANK, ERSOMHA_CATALOG, ERSOMHA_RETIRED, ERSOMHA_EXPECTED_COUNTS } from 'studio-preserved:arabic';
export { ERSOMHA_BANK_VERSION, ERSOMHA_BANK, ERSOMHA_CATALOG, ERSOMHA_RETIRED, ERSOMHA_EXPECTED_COUNTS };
import { ERSOMHA_ENGLISH_BANK as studioSourceEnglish } from 'studio-preserved:current';
const studioLocalize = ${localizePreservedBank.toString()};
const studioBaseEnglish = studioLocalize(studioSourceEnglish, ERSOMHA_BANK, ERSOMHA_CATALOG, ERSOMHA_RETIRED, ENGLISH_CONCEPT_ARABIC, ENGLISH_CONCEPT_EQUIVALENTS, arabicNormalizeLoose);
${hasSupplement ? `import studioSupplement from 'studio-preserved:supplement';
const studioMerge = ${mergePreservedEnglish.toString()};
export const ERSOMHA_ENGLISH_BANK = studioMerge(studioBaseEnglish, ERSOMHA_BANK, studioSupplement).entries;` : 'export const ERSOMHA_ENGLISH_BANK = studioBaseEnglish;'}
`;
  return source.slice(0, ast.body[first].range[0]) + replacement + source.slice(ast.body[last].range[1]);
}

export async function verifyStudioPrivateManifest(manifest, { repositoryRoot = ROOT } = {}) {
  assert.equal(manifest?.semanticSHA256, STUDIO_ARABIC_SEMANTIC_SHA256, 'The reviewed live Arabic digest is required.');
  const verified = await privateBankManifest(manifest.sourceRoot, { semanticSHA256: STUDIO_ARABIC_SEMANTIC_SHA256,
    moduleHashes: manifest.modules, counts: { version: 2, catalog: 1432, active: 1400, retired: 32 } }, { repositoryRoot });
  assert.deepEqual(verified, manifest, 'The frozen private source manifest changed.');
  return verified;
}

async function readEnglishSupplement(option, repo) {
  assert.match(option?.sha256 || '', /^[a-f0-9]{64}$/, 'Pin the reviewed private English supplement hash.');
  const filename = await realpath(option.path), relative = slash(path.relative(repo, filename));
  assert.ok(relative.startsWith('../') || path.isAbsolute(relative), 'English supplement must remain outside the public checkout.');
  const bytes = await readFile(filename); assert.ok(bytes.length <= 1024 * 1024, 'English supplement exceeds its reviewed bound.');
  assert.equal(hash(bytes), option.sha256, 'Private English supplement changed after review.');
  const value = JSON.parse(bytes);
  assert.equal(value.arabicSemanticSHA256, STUDIO_ARABIC_SEMANTIC_SHA256, 'English supplement belongs to another Arabic catalog.');
  return { value, sha256: hash(bytes), bytes: bytes.length };
}

function studioOverlay(manifest, repo, currentSource, loaded, inputs = new Map(), supplement) {
  const pinned = new Map(manifest.modules.map(entry => [entry.file, entry.sha256]));
  return { name: 'studio-preserve-arabic-and-localize', setup(builder) {
    assert.equal(builder.initialOptions.write, false, 'Private bundles must stay in memory.');
    assert.equal(builder.initialOptions.outfile, undefined); assert.equal(builder.initialOptions.outdir, undefined);
    builder.onResolve({ filter: /^studio-preserved:/ }, args => {
      if (args.path === 'studio-preserved:supplement') { assert.ok(supplement); return { path: 'english-supplement.json', namespace: 'studio-private-english' }; }
      assert.ok(['studio-preserved:arabic', 'studio-preserved:current'].includes(args.path), 'Unknown private adapter module.');
      return { path: 'server/ersomha-content.mjs', namespace: args.path.endsWith(':arabic') ? 'studio-private-arabic' : 'studio-current-content' };
    });
    builder.onLoad({ filter: /.*/, namespace: 'studio-private-english' }, args => {
      inputs.set(`${args.namespace}:${args.path}`, supplement.sha256);
      return { contents: JSON.stringify(supplement.value), loader: 'json' };
    });
    builder.onResolve({ filter: /^\./, namespace: 'studio-private-arabic' }, args => {
      const file = path.posix.normalize(path.posix.join(path.posix.dirname(args.importer), args.path));
      if (PRIVATE_FILE.test(file)) { assert.ok(pinned.has(file), 'Private runtime dependency is outside the reviewed manifest.'); return { path: file, namespace: 'studio-private-arabic' }; }
      assert.ok(file.startsWith('src/'), 'Unexpected private loader dependency.');
      return { path: path.resolve(repo, file) };
    });
    builder.onLoad({ filter: /.*/, namespace: 'studio-private-arabic' }, async args => {
      assert.ok(pinned.has(args.path), 'Private runtime module is not reviewed.');
      const bytes = await readFile(path.join(manifest.sourceRoot, args.path));
      assert.equal(hash(bytes), pinned.get(args.path), 'Private module changed after review.');
      loaded.add(args.path); inputs.set(`${args.namespace}:${args.path}`, hash(bytes));
      return { contents: bytes.toString('utf8'), loader: 'js', resolveDir: path.join(repo, 'server') };
    });
    builder.onLoad({ filter: /.*/, namespace: 'studio-current-content' }, args => {
      inputs.set(`${args.namespace}:${args.path}`, hash(currentSource));
      return { contents: currentSource, loader: 'js', resolveDir: path.join(repo, 'server') };
    });
    builder.onLoad({ filter: /[/\\]server[/\\]ersomha-content\.mjs$/, namespace: 'file' }, args => {
      if (path.resolve(args.path) !== path.resolve(repo, 'server/ersomha-content.mjs')) return;
      inputs.set('server/ersomha-content.mjs', hash(currentSource));
      return { contents: studioLoader(currentSource, Boolean(supplement)), loader: 'js', resolveDir: path.join(repo, 'server') };
    });
    builder.onLoad({ filter: /\.(?:m?js|json)$/, namespace: 'file' }, async args => {
      const file = slash(path.relative(repo, args.path));
      assert.ok(!file.startsWith('../') && !path.isAbsolute(file), 'Server dependency escaped the checkout.');
      // Pin the bytes actually given to the compiler, not a later filesystem
      // reread that could accidentally describe another concurrent edit.
      const bytes = await readFile(args.path); inputs.set(file, hash(bytes));
      return { contents: bytes.toString('utf8'), loader: file.endsWith('.json') ? 'json' : 'js', resolveDir: path.dirname(args.path) };
    });
  } };
}

// The inspection build runs the same loader overlay as the actual worker. It is
// never a shipped module or browser entry point and is not persisted to disk.
export async function inspectStudioPreservedContent(manifest, { repositoryRoot = ROOT, englishSupplement } = {}) {
  const repo = await realpath(repositoryRoot); await verifyStudioPrivateManifest(manifest, { repositoryRoot: repo });
  const supplement = englishSupplement && await readEnglishSupplement(englishSupplement, repo);
  const current = await readFile(path.join(repo, 'server/ersomha-content.mjs'), 'utf8'), loaded = new Set();
  const result = await build({ absWorkingDir: repo, stdin: { contents: "export * from './server/ersomha-content.mjs';", resolveDir: repo }, bundle: true, write: false,
    platform: 'neutral', format: 'esm', target: 'es2022', logLevel: 'silent', plugins: [studioOverlay(manifest, repo, current, loaded, new Map(), supplement)] });
  assert.deepEqual([...loaded].sort(), manifest.modules.map(entry => entry.file).sort());
  const module = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
  assert.equal(hash(JSON.stringify(module.ERSOMHA_BANK)), STUDIO_ARABIC_SEMANTIC_SHA256, 'Prepared Arabic bank semantics changed.');
  assert.equal(module.ERSOMHA_BANK.length, 1400); assert.equal(module.ERSOMHA_CATALOG.length, 1432); assert.equal(Object.keys(module.ERSOMHA_RETIRED).length, 32);
  return module;
}

export async function bundleStudioPreservedWorker(manifest, { repositoryRoot = ROOT, entryPoint = 'server/full-worker.mjs', englishSupplement } = {}) {
  assert.ok(ENTRYPOINTS.includes(entryPoint), 'Only reviewed server entry points may receive private content.');
  const repo = await realpath(repositoryRoot); await verifyStudioPrivateManifest(manifest, { repositoryRoot: repo });
  const supplement = await readEnglishSupplement(englishSupplement, repo);
  const content = await inspectStudioPreservedContent(manifest, { repositoryRoot: repo });
  const { coverage } = mergePreservedEnglish(content.ERSOMHA_ENGLISH_BANK, content.ERSOMHA_BANK, supplement.value);
  const current = await readFile(path.join(repo, 'server/ersomha-content.mjs'), 'utf8'), loaded = new Set(), inputs = new Map();
  const compiled = await build({ absWorkingDir: repo, entryPoints: [entryPoint], bundle: true, write: false, metafile: true, platform: 'browser', format: 'esm',
    target: 'es2022', minify: false, sourcemap: false, logLevel: 'silent', plugins: [studioOverlay(manifest, repo, current, loaded, inputs, supplement)] });
  assert.equal(compiled.outputFiles.length, 1); assert.deepEqual([...loaded].sort(), manifest.modules.map(entry => entry.file).sort());
  const bytes = Buffer.from(compiled.outputFiles[0].contents), sourceInputs = [];
  for (const input of Object.keys(compiled.metafile.inputs).sort()) {
    const file = input.replace(/^studio-private-arabic:|^studio-current-content:|^studio-private-english:/, '');
    assert.ok(!file.startsWith('../') && !path.isAbsolute(file), 'Server dependency escaped the checkout.');
    const digest = inputs.get(slash(input));
    assert.match(digest || '', /^[a-f0-9]{64}$/); sourceInputs.push({ file: slash(input), sha256: digest });
  }
  return { bytes, sha256: hash(bytes), byteLength: bytes.length, sourceInputs, sourceInputsSHA256: hash(JSON.stringify(sourceInputs)),
    entryPoint, containsPrivateContent: true, publicUploadAllowed: false, remoteWrites: false,
    contentCoverage: coverage, englishSupplement: { sha256: supplement.sha256, bytes: supplement.bytes, entries: supplement.value.entries.length },
    privateBank: { version: 2, active: 1400, catalog: 1432, retired: 32, semanticSHA256: STUDIO_ARABIC_SEMANTIC_SHA256, sourceManifestSHA256: manifest.sourceManifestSHA256 } };
}

// Deliberately fixed to the integrated preview entry point. The caller owns
// resource inheritance and deployment; this function can only prepare bytes.
export function bundleStudioPreviewWorker(manifest, { repositoryRoot = ROOT, englishSupplement } = {}) {
  return bundleStudioPreservedWorker(manifest, { repositoryRoot, englishSupplement, entryPoint: 'server/full-worker.mjs' });
}

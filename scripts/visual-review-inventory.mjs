// Local inventory only: no browser launch, API access, editor mutation or approval.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, readdir, mkdir, writeFile, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DESIGN_SCREENS } from '../src/design/registry.js';
import { VISUAL_REVIEW_VERSION, VISUAL_REVIEW_GAPS, VISUAL_REVIEW_LOCALES, VISUAL_REVIEW_VIEWPORTS } from '../src/design/visual-review.js';

// Resolve the parser through the existing declared ESLint dependency. No new
// app dependency and no interpretation/execution of scanned source is needed.
const require = createRequire(import.meta.resolve('eslint'));
const espree = require('espree');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXCLUDED = ['src/data/', 'src/design/'];

export function discoverVisualRoots(file, contents) {
  const roots = [], dynamic = [], parseErrors = [];
  let ast;
  try { ast = espree.parse(contents, { ecmaVersion:'latest', sourceType:'module', ecmaFeatures:{ jsx:true }, loc:true }); }
  catch (error) { return { roots, dynamic, parseErrors:[{ file, line:error.lineNumber || null, reason:'JavaScript/JSX parse failed; manual mapping required' }] }; }
  function value(node) {
    if (node?.type === 'JSXExpressionContainer') return value(node.expression);
    if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
    if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
    return null;
  }
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    let candidate, found = false;
    if (node.type === 'JSXAttribute' && node.name?.name === 'data-design-screen') { candidate = node.value; found = true; }
    if (node.type === 'Property' && value(node.key) === 'data-design-screen') { candidate = node.value; found = true; }
    if (found) {
      const id = value(candidate), location = { file, line:node.loc.start.line };
      if (id && /^[a-z][a-zA-Z0-9.-]+$/.test(id)) roots.push({ id, ...location });
      else dynamic.push({ ...location, expressionType:candidate?.type || 'MissingValue', status:'unmapped', reason:'Cannot establish all rendered IDs from a static literal' });
    }
    for (const [key, item] of Object.entries(node)) {
      if (key === 'loc') continue;
      if (Array.isArray(item)) item.forEach(visit);
      else if (item && typeof item === 'object') visit(item);
    }
  }
  visit(ast);
  return { roots, dynamic, parseErrors };
}

export function assembleVisualInventory({ registered, discoveries, gaps, source, sourceFiles = [] }) {
  const registeredIds = new Set(registered.map(row => row.id));
  if (registeredIds.size !== registered.length) throw new Error('Duplicate editor screen identity');
  const roots = discoveries.flatMap(row => row.roots), dynamic = discoveries.flatMap(row => row.dynamic);
  const parseErrors = discoveries.flatMap(row => row.parseErrors);
  const literalIds = new Set(roots.map(row => row.id));
  const all = [...new Set([...registeredIds, ...literalIds])].sort();
  const records = all.map(id => {
    const definition = registered.find(row => row.id === id);
    return { schemaVersion:VISUAL_REVIEW_VERSION, screen:id,
      state:definition?.phase || 'unmapped', role:definition?.role || 'unmapped', locale:null, viewport:null,
      family:definition?.group || 'unmapped', game:definition?.game || null, mode:definition?.mode || null,
      editorRegistered:registeredIds.has(id), sourceLocations:roots.filter(row => row.id === id).map(({ file,line }) => ({ file,line })),
      source, authorIds:[], reference:null, evidence:null, critics:[], approvedDeviations:[], reviewDecision:'not-reviewed',
      casesMapped:false };
  });
  const unregistered = [...literalIds].filter(id => !registeredIds.has(id)).sort();
  return { schemaVersion:VISUAL_REVIEW_VERSION, kind:'visual-review-inventory', status:'incomplete', complete:false,
    source, records, sourceFiles, plannedLocales:VISUAL_REVIEW_LOCALES, plannedViewports:VISUAL_REVIEW_VIEWPORTS,
    counts:{ registered:registered.length, staticRootIds:literalIds.size, union:all.length, unregistered:unregistered.length,
      accepted:0, unreviewed:records.length, declaredUnsurfacedGaps:gaps.length, dynamicRootSites:dynamic.length, parseErrors:parseErrors.length },
    differences:{ unregistered, registeredWithoutStaticLiteral:[...registeredIds].filter(id => !literalIds.has(id)).sort() },
    unknownPaths:[...dynamic, ...parseErrors, ...gaps.filter(row => row.pathExists === false).map(row => ({ file:row.path, reason:'Declared gap source is missing', status:'unmapped' }))],
    unsurfacedGaps:gaps.map(row => ({ ...row, status:'unmapped', reviewDecision:'not-reviewed' })),
    limitations:[
      'Static declarations are candidates, not proof that a screen is reachable or rendered.',
      'Dynamic expressions and declared unsurfaced areas require explicit state/role mappings and actual fixtures.',
      'No approved reference, current real capture or independent critic evidence has been supplied by this inventory.',
      'A legacy fixture pass, CSS measurement or game completion matrix is not visual acceptance.',
      'Native views need native captures; browser viewport emulation does not certify physical devices.',
    ] };
}

async function sourceFiles(root) {
  const found = [];
  async function walk(relative) {
    for (const entry of (await readdir(path.join(root, relative), { withFileTypes:true })).sort((a,b) => a.name.localeCompare(b.name))) {
      const file = `${relative}/${entry.name}`;
      if (entry.isDirectory() && !EXCLUDED.includes(file+'/')) await walk(file);
      else if (entry.isFile() && /\.(?:js|jsx|mjs)$/.test(file)) found.push(file);
    }
  }
  await walk('src'); return found;
}
function git(root, args) { return execFileSync('git', args, { cwd:root, maxBuffer:64*1024*1024 }); }
export async function createVisualInventory(root = ROOT) {
  const revision = git(root, ['rev-parse','HEAD']).toString().trim();
  const tree = git(root, ['rev-parse','HEAD^{tree}']).toString().trim();
  const diff = git(root, ['diff','--binary','HEAD','--']);
  const untracked = git(root, ['ls-files','--others','--exclude-standard','-z']).toString().split('\0').filter(Boolean).sort();
  const untrackedHashes = [];
  for (const file of untracked) untrackedHashes.push({ file, sha256:hash(await readFile(path.join(root,file))) });
  const status = git(root, ['status','--porcelain','--untracked-files=all']).toString();
  const source = { revision, tree, dirty:Boolean(status.trim()),
    fingerprint:hash(Buffer.concat([Buffer.from(revision+'\0'),diff,Buffer.from('\0'+JSON.stringify(untrackedHashes))])),
    fingerprintMethod:'SHA256(HEAD + NUL + git diff --binary HEAD + NUL + sorted untracked nonignored paths/actual-byte SHA256)' };
  const files = await sourceFiles(root), discoveries = [], scanned = [];
  for (const file of files) {
    const bytes = await readFile(path.join(root,file));
    scanned.push({ file, sha256:hash(bytes) }); discoveries.push(discoverVisualRoots(file,bytes.toString('utf8')));
  }
  const gaps = await Promise.all(VISUAL_REVIEW_GAPS.map(async gap => ({ ...gap, pathExists:await stat(path.join(root,gap.path)).then(value => value.isFile(), () => false) })));
  // Detect concurrent edits rather than publishing a mixed inventory snapshot.
  if (revision !== git(root,['rev-parse','HEAD']).toString().trim() || !diff.equals(git(root,['diff','--binary','HEAD','--'])) || status !== git(root,['status','--porcelain','--untracked-files=all']).toString()) throw new Error('Source changed during inventory; rerun read-only generation');
  for (const row of untrackedHashes) if (row.sha256 !== hash(await readFile(path.join(root,row.file)))) throw new Error('Untracked source changed during inventory');
  for (const row of scanned) if (row.sha256 !== hash(await readFile(path.join(root,row.file)))) throw new Error('Scanned source changed during inventory');
  return { generatedAt:new Date().toISOString(), parser:{ name:'espree',version:espree.version,resolvedThrough:'eslint' },
    discoveryScope:{ root:'src', extensions:['js','jsx','mjs'], excluded:EXCLUDED, ignoresStringsAndComments:true },
    ...assembleVisualInventory({ registered:DESIGN_SCREENS, discoveries, gaps, source, sourceFiles:scanned }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--output')) throw new Error('Usage: node scripts/visual-review-inventory.mjs [--output path.json]');
  const inventory = await createVisualInventory();
  if (args.length) {
    const target = path.resolve(args[1]);
    await mkdir(path.dirname(target),{ recursive:true });
    await writeFile(target,JSON.stringify(inventory,null,2)+'\n');
    console.log(JSON.stringify({ file:target,status:inventory.status,complete:inventory.complete,source:inventory.source,counts:inventory.counts }));
  } else console.log(JSON.stringify(inventory,null,2));
}

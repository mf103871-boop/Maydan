import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';
import { DESIGN_SCREENS, DESIGN_REGISTRY_VERSION } from '../src/design/registry.js';
import { createDefaultDesign, validateDesignDocument } from '../src/design/schema.js';
import { esbuildOptions } from '../scripts/lib.mjs';
import { isMainGameBuild, packedRuntimeRegistrySource } from '../scripts/design-runtime-packaging.mjs';

const load = source => import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const main = path.resolve('src/main.jsx');
async function buildRegistry(entry) {
  const file = path.resolve(entry);
  const options = esbuildOptions({ minify: true, version: 'registry-packaging-test', assets: 'files' });
  const fixture = { name: 'isolated-entry-fixture', setup(builder) {
    builder.onLoad({ filter: /\.(?:js|jsx)$/ }, args => path.resolve(args.path) === file ? {
      contents: `export * from ${JSON.stringify(path.resolve('src/design/registry.js'))};export {validateDesignDocument} from ${JSON.stringify(path.resolve('src/design/schema.js'))};`, loader: 'js',
    } : undefined);
  } };
  const result = await build({ ...options, entryPoints: [file], format: 'esm', platform: 'node',
    plugins: [fixture, ...options.plugins], write: false });
  return load(result.outputFiles.find(output => output.path.endsWith('.js')).text);
}

test('packed main registry preserves every identity, structural field and runtime guard', async () => {
  const packed = await load(packedRuntimeRegistrySource());
  assert.equal(packed.DESIGN_REGISTRY_VERSION, DESIGN_REGISTRY_VERSION);
  assert.equal(Object.isFrozen(packed.DESIGN_SCREENS), true);
  assert.equal(packed.DESIGN_SCREENS.length, DESIGN_SCREENS.length);
  let checked = 0;
  for (const [index, original] of DESIGN_SCREENS.entries()) {
    const screen = packed.DESIGN_SCREENS[index];
    assert.equal(screen, packed.getScreenDefinition(original.id));
    assert.equal(Object.isFrozen(screen), true);
    assert.equal(Object.isFrozen(screen.nodes), true);
    for (const key of Object.keys(original).filter(key => !['label','group','nodes'].includes(key)))
      assert.deepEqual(screen[key], original[key], `${original.id}.${key}`);
    assert.equal(screen.label, undefined); assert.equal(screen.group, undefined);
    assert.equal(screen.nodes.length, original.nodes.length);
    for (const [n, definition] of original.nodes.entries()) {
      const node = screen.nodes[n]; checked++;
      assert.equal(node, packed.getNodeDefinition(screen.id, definition.id));
      assert.equal(Object.isFrozen(node), Object.isFrozen(definition));
      for (const field of Object.keys(definition).filter(key => !['label','coverageReason'].includes(key)))
        assert.deepEqual(node[field], definition[field], `${screen.id}:${node.id}.${field}`);
      assert.equal(node.label, undefined); assert.equal(node.coverageReason, undefined);
      if (node.editableStyle) assert.equal(Object.isFrozen(node.editableStyle), Object.isFrozen(definition.editableStyle));
    }
  }
  assert.ok(checked >= 2000);
  assert.equal(packed.getScreenDefinition('__proto__'), null);
  assert.equal(packed.getNodeDefinition('home', '__proto__'), null);
});

test('explicit editor blacklist retains unknown future guards and fails closed on unsupported values', async () => {
  const guarded = Object.freeze({ id: 'custom.action', label: 'Editor only', coverageReason: 'Editor only', kind: 'button', required: true,
    futureGuard: Object.freeze({ epoch: 7, needsConsent: true }), futureList: Object.freeze(['current-owner']) });
  const screen = Object.freeze({ id: 'future-screen', label: 'Editor only', group: 'Editor only', game: 'mafia', phase: 'night',
    futureScreenGuard: Object.freeze({ private: true }), nodes: Object.freeze([guarded]) });
  const packed = await load(packedRuntimeRegistrySource({ screens: [screen] }));
  assert.deepEqual(packed.getNodeDefinition(screen.id, guarded.id).futureGuard, guarded.futureGuard);
  assert.equal(Object.isFrozen(packed.getNodeDefinition(screen.id, guarded.id).futureGuard), true);
  assert.equal(Object.isFrozen(packed.getNodeDefinition(screen.id, guarded.id).futureList), true);
  assert.deepEqual(packed.getScreenDefinition(screen.id).futureScreenGuard, screen.futureScreenGuard);
  for (const unsupported of [undefined, () => true, Infinity, NaN, 1n, new Date()])
    assert.throws(() => packedRuntimeRegistrySource({ screens: [{ ...screen, nodes: [{ ...guarded, futureGuard: unsupported }] }] }), /non-JSON/);
});

test('only the actual single main entry qualifies, even when options are reused by Studio', () => {
  for (const entryPoints of [[main], [{ in: main, out: 'game' }], { game: main }])
    assert.equal(isMainGameBuild({ entryPoints }), true);
  for (const entryPoints of [[path.resolve('src/studio/main.jsx')], [path.resolve('src/design/preview-main.jsx')], [main, path.resolve('src/design/preview-main.jsx')], [], undefined])
    assert.equal(isMainGameBuild({ entryPoints }), false);
  assert.equal(isMainGameBuild({ entryPoints: [main], stdin: { contents: 'arbitrary' } }), false);
});

test('actual compiler projects main only; Studio and design-preview retain full rich metadata', async () => {
  const game = await buildRegistry('src/main.jsx');
  assert.equal(game.getNodeDefinition('home', 'rooms').label, undefined);
  assert.equal(game.getNodeDefinition('home', 'rooms').required, DESIGN_SCREENS.find(screen => screen.id === 'home').nodes.find(node => node.id === 'rooms').required);
  for (const entry of ['src/studio/main.jsx', 'src/design/preview-main.jsx']) {
    const full = await buildRegistry(entry);
    assert.deepEqual(full.DESIGN_SCREENS, DESIGN_SCREENS, entry);
    assert.ok(full.getNodeDefinition('home', 'rooms').coverageReason.length > 35);
  }
});

test('compiled runtime schema makes the same protection and validation decisions for every source node', async () => {
  const game = await buildRegistry('src/main.jsx');
  const probes = [{ visible: false }, { text: 'نص بديل' }, { icon: 'none' }, { style: { opacity: .5 } }, { style: { borderRadius: 12 } }, { layouts: { portrait: { x: .2, y: .1, width: .3, height: .2 } } }];
  for (const screen of DESIGN_SCREENS) for (const node of screen.nodes) for (const patch of probes) {
    const document = { ...createDefaultDesign(), screens: { [screen.id]: { nodes: { [node.id]: patch }, decorations: [] } } };
    assert.deepEqual(game.validateDesignDocument(document), validateDesignDocument(document), `${screen.id}:${node.id}:${JSON.stringify(patch)}`);
  }
});

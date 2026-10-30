import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, writeFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { esbuildOptions, minifiedCssTextPlugin } from '../scripts/lib.mjs';

const source = `/* Original authored spacing and comments stay in development. */
:root {
  --mafia-accent: #FFFFFF;
  --space: 7px;
  --width: calc(100% - var(--space));
}
.sample[data-label="ميدان"] {
  color: #FFFFFF;
  padding: 1px 1px 1px 1px;
  width: calc(100% - var(--space));
  font-family: "خط ميدان", sans-serif;
  backdrop-filter: blur(2px);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E");
  animation: maydan-pulse 2s ease-in-out infinite;
}
.sample::before { content: "أهلًا ميدان /* text, not a comment */"; }
@keyframes maydan-pulse {
  from { opacity: 0.5; transform: translateX(0); }
  to { opacity: 1; transform: translateX(calc(var(--space) + 1px)); }
}
@media (max-width: 430px) {
  .sample { width: calc(100% - 12px); }
}
@supports (display: grid) { .sample { display: grid; } }
`;

async function fixture(t) {
  const folder = await mkdtemp(path.join(tmpdir(), 'maydan-css-text-'));
  t.after(async () => {
    const root = await realpath(tmpdir()), target = await realpath(folder);
    assert.equal(path.dirname(target), root);
    assert.ok(path.basename(target).startsWith('maydan-css-text-'));
    await rm(target, { recursive: true, force: true });
  });
  const file = path.join(folder, 'sample.css');
  await writeFile(file, source, 'utf8');
  return { folder, file };
}

test('CSS text minification keeps UTF-8, names, declaration syntax and watched source ownership', async t => {
  const { file, folder } = await fixture(t);
  let handler, filter;
  minifiedCssTextPlugin().setup({ onLoad(options, callback) { filter = options; handler = callback; } });
  assert.equal(filter.namespace, 'file'); assert.ok(filter.filter.test(file));
  const result = await handler({ path: file });
  assert.equal(result.loader, 'text'); assert.equal(result.resolveDir, folder);
  assert.deepEqual(result.watchFiles, [file]); assert.deepEqual(result.warnings, []);
  assert.ok(Buffer.byteLength(result.contents) < Buffer.byteLength(source));
  assert.doesNotMatch(result.contents, /Original authored spacing/);
  assert.match(result.contents, /أهلًا ميدان \/\* text, not a comment \*\//);
  assert.match(result.contents, /color:#FFFFFF/); // no color or shorthand optimization
  assert.match(result.contents, /padding:1px 1px 1px 1px/);
  assert.match(result.contents, /--mafia-accent:/); assert.match(result.contents, /--width:/);
  assert.match(result.contents, /calc\(100% - var\(--space\)\)/);
  assert.match(result.contents, /calc\(var\(--space\) \+ 1px\)/);
  assert.match(result.contents, /@keyframes maydan-pulse/); assert.match(result.contents, /animation:maydan-pulse/);
  assert.match(result.contents, /@media\s*\(max-width:\s*430px\)/); assert.match(result.contents, /@supports\s*\(display:\s*grid\)/);
  assert.match(result.contents, /data:image\/svg\+xml,%3Csvg/);
  assert.doesNotMatch(result.contents, /-webkit-backdrop-filter/); // no CSS feature/prefix rewrite
});

test('only minified application bundles compact CSS strings; development remains byte-identical', async t => {
  const { file, folder } = await fixture(t);
  async function bundled(minify) {
    const options = esbuildOptions({ minify, assets: 'files' });
    const result = await build({ ...options, entryPoints: [],
      stdin: { contents: `import css from ${JSON.stringify(file)}; globalThis.fixtureCSS = css;`, resolveDir: folder },
      outfile: path.join(folder, 'bundle.js') });
    assert.deepEqual(result.warnings, []);
    const sandbox = {};
    vm.runInNewContext(result.outputFiles.find(output => output.path.endsWith('.js')).text, sandbox);
    return sandbox.fixtureCSS;
  }
  const development = await bundled(false), production = await bundled(true);
  assert.equal(development, source);
  assert.equal(typeof production, 'string');
  assert.ok(Buffer.byteLength(production) < Buffer.byteLength(development));
  assert.match(production, /أهلًا ميدان/);
  assert.equal(esbuildOptions({ minify: false }).plugins, undefined);
  assert.equal(esbuildOptions({ minify: true }).plugins[0].name, 'minified-css-text');
});

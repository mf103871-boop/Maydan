import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isPackFile } from '../../src/boot/pack-format.js';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const entry = (file, body) => ({ file, bytes: Buffer.byteLength(body), sha256: digest(body) });

async function collect(dir, prefix, files) {
  for (const child of await readdir(dir, { withFileTypes: true })) {
    const file = prefix + child.name;
    if (child.isDirectory()) {
      if (!isPackFile(file + '/resource.webp')) continue;
      await collect(path.join(dir, child.name), file + '/', files);
    } else if (child.isFile() && isPackFile(file)) files.add(file);
  }
}

// A caller-supplied destination can already contain a studio, a prior release,
// or unrelated files. Enumerate only inputs that this build actually copied.
export async function writeWebGamePack({ root, outdir, outputs, template, worker, renderWorker, includePackTransport = false }) {
  const files = new Set(outputs);
  await collect(path.join(root, 'public'), '', files);
  await collect(path.join(root, 'media'), 'media/', files);
  files.delete('index.html');
  files.delete('sw.js');
  const assets = [], chunks = [];
  let hash, group;
  const transport = path.join(outdir, 'game-pack/download');
  let bodies = [];
  if (includePackTransport) await mkdir(transport, { recursive: true });
  async function finishChunk(chunk) {
    chunk.sha256 = hash.digest('hex');
    if (includePackTransport) {
      const first = assets[chunk.first].file;
      if (first !== 'index.html' && first !== 'sw.js') {
        await writeFile(path.join(transport, chunk.sha256 + '.bin'), Buffer.concat(bodies, chunk.bytes));
      }
      bodies = [];
    }
  }
  const add = async (file, body) => {
    const input = entry(file, body);
    const folder = path.posix.dirname(file);
    let chunk = chunks.at(-1);
    if (!chunk || group !== folder || chunk.count >= 96 || chunk.bytes + input.bytes > 2 * 1024 * 1024) {
      if (hash) await finishChunk(chunk);
      group = folder;
      hash = createHash('sha256');
      chunk = { first: assets.length, count: 0, bytes: 0, sha256: '' };
      chunks.push(chunk);
    }
    assets.push(input);
    hash.update(body);
    if (includePackTransport) bodies.push(body);
    chunk.bytes += input.bytes;
    chunk.count++;
  };
  for (const file of [...files].sort()) {
    if (!isPackFile(file)) throw new Error('Unexpected game output: ' + file);
    await add(file, await readFile(path.join(outdir, file)));
  }
  // Derive the immutable name from the un-stamped shell and worker. Final
  // hashes of both belong in the inventory, without a self-reference cycle.
  const id = digest(JSON.stringify([digest(template), digest(renderWorker(worker, '', 'seed')), assets, includePackTransport]));
  const manifest = './game-pack/' + id + '.json';
  const html = template.replace('</head>', '<meta name="maydan-game-pack" content="' + manifest + '"></head>');
  const serviceWorker = renderWorker(worker, manifest, html);
  await add('index.html', html);
  await add('sw.js', serviceWorker);
  await finishChunk(chunks.at(-1));
  const data = { schema: 2, id, files: assets, chunks, totalFiles: assets.length, totalBytes: assets.reduce((n, item) => n + item.bytes, 0) };
  if (includePackTransport) data.transport = 'chunks-v1';
  await mkdir(path.join(outdir, 'game-pack'), { recursive: true });
  await writeFile(path.join(outdir, manifest), JSON.stringify(data));
  await writeFile(path.join(outdir, 'sw.js'), serviceWorker);
  await writeFile(path.join(outdir, 'index.html'), html);
  return { html, manifest, totalBytes: data.totalBytes, totalFiles: data.totalFiles };
}

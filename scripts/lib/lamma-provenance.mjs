import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { build } from 'esbuild';

const execute = promisify(execFile);
async function backendSourceFiles(root) {
  const files = new Set(['package-lock.json']);
  async function walk(directory) {
    for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
      const relative = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await walk(relative);
      else if (entry.isFile() && /\.(mjs|sql)$/.test(entry.name)) files.add(relative);
    }
  }
  await walk('server');
  const compiled = await build({ entryPoints: ['server/worker.mjs', 'server/full-worker.mjs'],
    absWorkingDir: root, outdir: '.cache/lamma-provenance-unused', bundle: true, write: false, metafile: true,
    platform: 'browser', format: 'esm', target: 'es2022', minify: false, sourcemap: false, logLevel: 'silent' });
  for (const input of Object.keys(compiled.metafile.inputs)) {
    const relative = path.relative(root, path.resolve(root, input)).split(path.sep).join('/');
    if (relative.startsWith('../') || path.isAbsolute(relative)) throw Error('Backend dependency outside repository.');
    files.add(relative);
  }
  return [...files].sort();
}
async function hashSources(root, files) {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file).update('\0').update((await readFile(path.join(root, file), 'utf8')).replace(/\r\n/g, '\n')).update('\0');
  }
  return hash.digest('hex');
}
export async function backendTreeSha256(root) {
  return hashSources(root, await backendSourceFiles(root));
}
export async function getBackendProvenance(root, { requireClean = false } = {}) {
  const git = async (...args) => (await execute('git', args, { cwd: root, windowsHide: true })).stdout.trim();
  const files = await backendSourceFiles(root);
  if (requireClean && await git('status', '--porcelain', '--untracked-files=all', '--', 'server', ...files)) throw Error('Commit the backend and its dependencies before provider acceptance.');
  const [sourceCommit, sourceServerTree, digest] = await Promise.all([git('rev-parse', 'HEAD'), git('rev-parse', 'HEAD:server'), hashSources(root, files)]);
  return { sourceCommit, sourceServerTree, backendTreeSha256: digest };
}

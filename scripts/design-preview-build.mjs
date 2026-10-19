import { build } from 'esbuild';
import { mkdir,writeFile,readFile } from 'node:fs/promises';
import path from 'node:path';
import { esbuildOptions,ROOT,DIST,escapeInlineScript } from './lib.mjs';
export async function buildDesignPreview({outdir=DIST,minify=true,version='1.8',media={}}={}) {
  const options=esbuildOptions({minify,version,media});
  const result=await build({...options,entryPoints:[path.join(ROOT,'src/design/preview-bootstrap.js')],outfile:path.join(outdir,'studio/preview/bundle.js')});
  const js=result.outputFiles.find(file=>file.path.endsWith('.js')).text;
  const tokens=await readFile(path.join(ROOT,'src/shared/theme/tokens.css'),'utf8');
  const html=`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><base href="/"><title>معاينة استوديو ميدان</title><style>${tokens}</style></head><body><div id="root"></div><script>${escapeInlineScript(js)}</script></body></html>`;
  const target=path.join(outdir,'studio/preview');await mkdir(target,{recursive:true});
  await writeFile(path.join(target,'index.html'),html,'utf8');
  const playResult=await build({...options,entryPoints:[path.join(ROOT,'src/studio/game-main.jsx')],outfile:path.join(outdir,'studio/play/bundle.js')});
  const playJS=playResult.outputFiles.find(file=>file.path.endsWith('.js')).text;
  const playHTML=`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><base href="/"><title>تجربة تصميم ميدان</title><style>${tokens}</style></head><body><div id="root"></div><script>${escapeInlineScript(playJS)}</script></body></html>`;
  await mkdir(path.join(outdir,'studio/play'),{recursive:true});await writeFile(path.join(outdir,'studio/play/index.html'),playHTML,'utf8');
  return {bytes:Buffer.byteLength(html)+Buffer.byteLength(playHTML),files:['studio/preview/index.html','studio/play/index.html']};
}

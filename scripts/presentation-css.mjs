import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { transform } from 'esbuild';

// Opt-in presentation resources. The file build emits local hashed CSS beside
// the other packaged assets; standalone/Studio documents keep their own CSS.
// No runtime fetch, Blob URL, external stylesheet or global style registry.
export function presentationCssPlugin({ assets = 'inline', minify = true } = {}) {
  return {
    name: 'maydan-presentation-css',
    setup(build) {
      build.onResolve({ filter: /\.css\?sheet$/ }, args => ({
        path: path.resolve(args.resolveDir, args.path.slice(0, -6)),
        namespace: 'maydan-presentation-sheet',
      }));
      build.onResolve({ filter: /\.css\?sheet-file$/ }, args => ({
        path: args.path.slice(0, -11), namespace: 'maydan-presentation-file',
      }));
      const css = async file => {
        const source = await readFile(file, 'utf8');
        // Moving a stylesheet changes relative URL resolution. Asset selection
        // belongs to the existing catalog/JS layer; never silently break a URL.
        if (/@import\b/i.test(source) || /url\(\s*['"]?(?![/'"#]|data:|https?:|maydan:)[^\s'"()]+/i.test(source)) {
          throw new Error('Presentation CSS requires catalog/root asset URLs; relative URLs and @import are unsupported.');
        }
        if (!minify) return source;
        return (await transform(source, { sourcefile: file, loader: 'css',
          minifyWhitespace: true, minifySyntax: false, minifyIdentifiers: false,
          charset: 'utf8', legalComments: 'none' })).code;
      };
      build.onLoad({ filter: /.*/, namespace: 'maydan-presentation-sheet' }, async args => {
        const text = await css(args.path);
        const contents = assets === 'files'
          ? `import href from ${JSON.stringify(args.path + '?sheet-file')}; export default Object.freeze({href});`
          : `export default Object.freeze({inline:${JSON.stringify(text)}});`;
        return { contents, loader: 'js', resolveDir: path.dirname(args.path), watchFiles: [args.path] };
      });
      build.onLoad({ filter: /.*/, namespace: 'maydan-presentation-file' }, async args => ({
        contents: await css(args.path), loader: 'file', resolveDir: path.dirname(args.path), watchFiles: [args.path],
      }));
    },
  };
}

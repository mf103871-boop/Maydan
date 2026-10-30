// The game reader needs every semantic identity and guard, but not the editor's
// labels or coverage prose. Studio and its preview keep the complete source.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DESIGN_REGISTRY_VERSION, DESIGN_SCREENS } from '../src/design/registry.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = path.join(ROOT, 'src/main.jsx');
const REGISTRY = path.join(ROOT, 'src/design/registry.js');
const SCREEN_EDITOR_FIELDS = new Set(['label', 'group']);
const NODE_EDITOR_FIELDS = new Set(['label', 'coverageReason']);
function assertRuntimeData(value, ancestors = new Set()) {
  if (value === null || ['string','boolean'].includes(typeof value)
    || typeof value === 'number' && Number.isFinite(value)) return;
  if (!value || typeof value !== 'object' || ancestors.has(value)
    || !Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    throw new TypeError('Registry packaging refuses a non-JSON runtime field');
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string')) throw new TypeError('Symbol registry fields are unsupported');
  ancestors.add(value);
  for (const child of Object.values(value)) assertRuntimeData(child, ancestors);
  ancestors.delete(value);
}

export function runtimeRegistryProjection(screens = DESIGN_SCREENS) {
  return screens.map(screen => Object.fromEntries(Object.entries(screen)
    .filter(([key]) => !SCREEN_EDITOR_FIELDS.has(key))
    .map(([key, value]) => [key, key === 'nodes' ? value.map(node => Object.fromEntries(Object.entries(node)
      .filter(([field]) => !NODE_EDITOR_FIELDS.has(field)))) : value])));
}

export function isMainGameBuild(options) {
  if (options.stdin) return false;
  const entries = options.entryPoints;
  const paths = Array.isArray(entries) ? entries.map(entry => typeof entry === 'string' ? entry : entry?.in)
    : entries && typeof entries === 'object' ? Object.values(entries) : [];
  return paths.length === 1 && typeof paths[0] === 'string'
    && path.resolve(options.absWorkingDir || process.cwd(), paths[0]) === MAIN;
}

export function packedRuntimeRegistrySource({ screens = DESIGN_SCREENS, registryVersion = DESIGN_REGISTRY_VERSION } = {}) {
  const projected = runtimeRegistryProjection(screens), templates = [], templateIds = new Map();
  assertRuntimeData(projected);
  const rows = projected.map(screen => [
    Object.fromEntries(Object.entries(screen).map(([key, value]) => [key, key === 'nodes' ? null : value])),
    screen.nodes.map(node => {
      const identity = JSON.stringify(node);
      if (!templateIds.has(identity)) { templateIds.set(identity, templates.length); templates.push(node); }
      return templateIds.get(identity);
    }),
  ]);
  const keys = [], keyIds = new Map(), schemas = [], schemaIds = new Map();
  const encode = value => {
    if (Array.isArray(value)) return [1, Object.isFrozen(value), ...value.map(encode)];
    if (value === null || ['string', 'boolean'].includes(typeof value)) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
      throw new TypeError('Registry packaging refuses a non-JSON runtime field');
    const shape = Object.keys(value).map(key => {
      if (!keyIds.has(key)) { keyIds.set(key, keys.length); keys.push(key); }
      return keyIds.get(key);
    });
    const identity = shape.join(',');
    if (!schemaIds.has(identity)) { schemaIds.set(identity, schemas.length); schemas.push(shape); }
    return [0, schemaIds.get(identity), Object.isFrozen(value), ...Object.values(value).map(encode)];
  };
  const encoded = encode([templates, rows]);
  return `const keys=${JSON.stringify(keys)},schemas=${JSON.stringify(schemas)};
const decode=v=>{if(!Array.isArray(v))return v;const a=v[0]===1,value=a?v.slice(2).map(decode):Object.fromEntries(schemas[v[1]].map((key,i)=>[keys[key],decode(v[i+3])]));return v[a?1:2]?Object.freeze(value):value;};
const[templates,rows]=decode(${JSON.stringify(encoded)});
export const DESIGN_REGISTRY_VERSION=${JSON.stringify(registryVersion)};
export const DESIGN_SCREENS=Object.freeze(rows.map(([screen,nodes])=>Object.freeze({...screen,nodes:Object.freeze(nodes.map(i=>Object.freeze({...templates[i]})))})));
const byId=new Map(DESIGN_SCREENS.map(value=>[value.id,value]));
export function getScreenDefinition(id){return byId.get(String(id||''))||null;}
export function getNodeDefinition(screenId,nodeId){return getScreenDefinition(screenId)?.nodes.find(value=>value.id===nodeId)||null;}`;
}

export function designRuntimePackagingPlugin() {
  return { name: 'main-game-design-registry', setup(builder) {
    // Check the builder's final entry points, including callers that spread
    // esbuildOptions() and then replace main with a Studio/preview entry.
    if (!isMainGameBuild(builder.initialOptions)) return;
    builder.onLoad({ filter: /[/\\]src[/\\]design[/\\]registry\.js$/ }, args => {
      if (path.resolve(args.path) !== REGISTRY) return undefined;
      return { contents: packedRuntimeRegistrySource(), loader: 'js',
        watchFiles: [REGISTRY, path.join(ROOT, 'src/design/coverage-map.js')] };
    });
  } };
}

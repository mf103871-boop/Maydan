// Lossless build-time key dictionary. Source provenance and sealed media stay
// byte-identical; repeated diagnostic keys need not bloat the startup document.
import { CANDIDATE_BUNDLE_ID, CANDIDATE_FILES, CANDIDATE_AUDITIONS, CANDIDATE_EFFECTS, CANDIDATE_SCENES } from '../../src/shared/fx/audio-candidate-catalog.js';

export function packedAudioCatalogSource() {
  const keys = [], indices = new Map(), schemas = [], schemaIds = new Map(), frequencies = new Map();
  const count = value => {
    if (typeof value === 'string') frequencies.set(value, (frequencies.get(value) || 0) + 1);
    else if (value && typeof value === 'object') for (const child of Object.values(value)) count(child);
  };
  count(CANDIDATE_FILES);
  const strings = [...frequencies].filter(([value, n]) => (n - 1) * (value.length + 2) > n * 5 + 4).map(([value]) => value);
  const stringIds = new Map(strings.map((value, i) => [value, i]));
  const encode = (value) => {
    if (Array.isArray(value)) return [1, ...value.map(encode)];
    if (typeof value === 'string' && stringIds.has(value)) return [2, stringIds.get(value)];
    if (!value || typeof value !== 'object') return value;
    const shape = Object.keys(value).map(key => {
      if (!indices.has(key)) { indices.set(key, keys.length); keys.push(key); }
      return indices.get(key);
    });
    const identity = shape.join(',');
    if (!schemaIds.has(identity)) { schemaIds.set(identity, schemas.length); schemas.push(shape); }
    return [0, schemaIds.get(identity), ...Object.values(value).map(encode)];
  };
  const encoded = encode(CANDIDATE_FILES);
  const refs = (map) => JSON.stringify(Object.fromEntries(Object.entries(map).map(([key, value]) => [key, value.id])));
  return `const keys=${JSON.stringify(keys)},schemas=${JSON.stringify(schemas)},strings=${JSON.stringify(strings)};
const decode=v=>!Array.isArray(v)?v:v[0]===2?strings[v[1]]:v[0]===1?v.slice(1).map(decode):Object.fromEntries(schemas[v[1]].map((key,i)=>[keys[key],decode(v[i+2])]));
const freeze=v=>{if(v&&typeof v==='object'&&!Object.isFrozen(v)){for(const c of Object.values(v))freeze(c);Object.freeze(v);}return v;};
export const CANDIDATE_BUNDLE_ID=${JSON.stringify(CANDIDATE_BUNDLE_ID)};
export const CANDIDATE_FILES=freeze(decode(${JSON.stringify(encoded)}));
const byId=Object.fromEntries(CANDIDATE_FILES.map(v=>[v.id,v]));
const resolve=refs=>freeze(Object.fromEntries(Object.entries(refs).map(([key,id])=>[key,byId[id]])));
export const CANDIDATE_AUDITIONS=resolve(${refs(CANDIDATE_AUDITIONS)});
export const CANDIDATE_EFFECTS=resolve(${refs(CANDIDATE_EFFECTS)});
export const CANDIDATE_SCENES=resolve(${refs(CANDIDATE_SCENES)});`;
}

export function audioCatalogPackagingPlugin() {
  return { name: 'lossless-audio-catalog', setup(builder) {
    builder.onLoad({ filter: /[/\\]src[/\\]shared[/\\]fx[/\\]audio-candidate-catalog\.js$/ }, () => ({
      contents: packedAudioCatalogSource(), loader: 'js',
    }));
  } };
}

import { audioAuditionBuildEnabled, isWarmthPreviewBuild, warmthPreviewLocation, WARMTH_SOURCE_MANIFEST_SHA256 } from './warmth-preview-policy.js';
// The loopback lab and explicitly pinned private iOS preview share one renderer.
// Neither path promotes an asset into a production reviewed registry.
export const LOCAL_CUE_KEYS = Object.freeze(['click', 'pop', 'tick', 'tickFast', 'countdown', 'start', 'correct', 'wrong', 'buzzer', 'timeout', 'whoosh', 'reveal', 'win', 'explosion', 'drumroll', 'pass', 'timerWarning']);
const MAFIA_KEYS = ['mafiaSelect', 'mafiaRole', 'mafiaNight', 'mafiaDawn', 'mafiaVerdict', 'mafiaFinal'];
const SPECIAL_KEYS = ['mafiaAssassination', 'mafiaJudgment'];
const cueName = key => key === 'win' ? 'fanfare' : key === 'start' ? 'countdownGo' : key;
const approvalsPending = value => value === false || !!value && ['listeningApproved', 'deviceTested', 'productionApproved', 'loopApproved'].every(key => value[key] === false);
const loopback = url => ['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && !url.username && !url.password;

export function createLocalAudition(options) {
  // Check the compile-time constant before reading any browser state. Regular
  // builds define it false and can remove this whole dependency.
  if (!audioAuditionBuildEnabled() || options?.mode !== 'candidate') return null;
  const warmth = isWarmthPreviewBuild();
  let origin, base;

  // An explicitly selected candidate mode fails silent, including a malformed
  // pack. It must never become an accidental comparison with the old bank.
  const bank = {}, cues = Object.fromEntries([...LOCAL_CUE_KEYS.map(cueName), ...MAFIA_KEYS, ...SPECIAL_KEYS].map(key => [key, null]));
  const assets = {}, suites = {}, directions = {};
  const result = { bank, cues, assets, suites, directions, directionId: options.directionId === undefined ? 'primary' : ['primary', 'bossaAlternative', 'timeAlternative'].includes(options.directionId) ? options.directionId : null, musicId: null };
  const finish = () => { for (const value of [bank, cues, assets, suites, directions, result]) Object.freeze(value); return result; };
  try {
    origin = new URL(window.location.href);
    if (!(warmth ? warmthPreviewLocation(origin) : loopback(origin))) return warmth ? finish() : null;
  } catch { return warmth ? finish() : null; }
  try {
    base = new URL(options.baseUrl || './', origin);
    // Custom WKWebView origins serialize to null. Compare scheme and host too;
    // otherwise another custom scheme could accidentally pass same-origin.
    if (base.protocol !== origin.protocol || base.host !== origin.host || base.origin !== origin.origin ||
      !(warmth ? warmthPreviewLocation(base) && base.pathname === '/audio-warmth-preview/' : loopback(base)) ||
      base.search || base.hash || !base.pathname.endsWith('/')) return finish();
  } catch { return finish(); }
  const pack = options.pack;
  if (warmth && (pack?.sourceManifestSHA256 !== WARMTH_SOURCE_MANIFEST_SHA256 || pack?.testFlightPreviewOnly !== true || options.directionId !== 'bossaAlternative')) return finish();
  if (pack?.schemaVersion !== 1 || pack.localPreviewOnly !== true || !approvalsPending(pack.approval) || !pack.assets || typeof pack.assets !== 'object' || Array.isArray(pack.assets)) return finish();

  for (const [id, entry] of Object.entries(pack.assets).slice(0, 64)) {
    const file = entry?.file;
    if (!/^[a-z][a-z\d-]{0,79}$/.test(id) || entry.id !== id || entry.localPreviewOnly !== true || !approvalsPending(entry.approval) || entry.loop !== false || !['effect', 'music', 'ambience'].includes(entry.kind) || !file) continue;
    if (!/^[a-f\d]{64}$/.test(file.sha256 || '') || file.url !== `audio/${id}-${file.sha256.slice(0, 12)}.m4a`) continue;
    if (!Number.isSafeInteger(file.bytes) || file.bytes <= 0 || file.bytes > (entry.kind === 'effect' ? 2 * 1024 ** 2 : 64 * 1024 ** 2) || !Number.isSafeInteger(file.frames) || file.frames <= 0 || !Number.isSafeInteger(file.sampleRate) || file.sampleRate < 8000 || file.sampleRate > 96000 || ![1, 2].includes(file.channels)) continue;
    const seconds = file.frames / file.sampleRate;
    if (!Number.isFinite(file.durationSeconds) || Math.abs(seconds - file.durationSeconds) > 0.001 || seconds > (entry.kind === 'effect' ? 6 : 900)) continue;
    const url = new URL(file.url, base);
    // Only project the fields the renderer needs. Source documents, paths and
    // approval flags stay in the lab manifest, outside the production bundle.
    assets[id] = Object.freeze({ id, title: typeof entry.titleAr === 'string' ? entry.titleAr.slice(0, 120) : typeof entry.title === 'string' ? entry.title.slice(0, 120) : id, kind: entry.kind, url: url.href, sha256: file.sha256, bytes: file.bytes, frames: file.frames, sampleRate: file.sampleRate, channels: file.channels, seconds, loop: false, crossfadeSeconds: 0 });
  }
  const map = (keys, decisions) => {
    for (const key of keys) {
      const choice = decisions?.[key], entry = assets[choice?.assetId];
      if (choice?.decision !== 'candidate' || choice.rate !== 1 || !entry || entry.kind !== 'effect') continue;
      if (key === 'timerWarning' && entry.seconds > .85) continue;
      bank[entry.id] = entry; cues[cueName(key)] = entry.id;
    }
  };
  // Require an explicit decision for the complete canonical vocabulary. Missing
  // decisions remain silent; other valid entries can still be compared.
  map(LOCAL_CUE_KEYS, pack.cueMap); map(MAFIA_KEYS, pack.mafiaCueMap); map(SPECIAL_KEYS, pack.mafiaPublicSpecialCueMap);
  for (const [id, suite] of Object.entries(pack.musicSuites || {}).slice(0, 8)) {
    if (!/^[a-z][a-z\d-]{0,79}$/.test(id) || assets[id] || !suite || !Array.isArray(suite.trackIds) || suite.trackIds.length < 3 || suite.trackIds.length > 12 || typeof suite.repeat !== 'boolean' || !Number.isFinite(suite.transitionSeconds) || suite.transitionSeconds < .2 || suite.transitionSeconds > 2) continue;
    const tracks = suite.trackIds.map(key => assets[key]);
    if (tracks.some(track => !track || track.kind !== 'music') || new Set(tracks.map(track => track.sha256)).size !== tracks.length) continue;
    if (suite.introTrackId !== undefined && !suite.trackIds.includes(suite.introTrackId)) continue;
    const total = tracks.reduce((sum, track) => sum + track.seconds, 0);
    if (total > 7200) continue;
    // The suite URL is an internal identity; only chapter URLs reach Audio.src.
    // A bad chapter invalidates the whole suite instead of falling back to the old bank.
    suites[id] = Object.freeze({ id, title: typeof suite.title === 'string' ? suite.title.slice(0, 120) : id, kind: 'music', url: new URL(`suite/${id}`, base).href, seconds: total,
      suiteTracks: Object.freeze(tracks), introTrackId: suite.introTrackId || null, transitionSeconds: suite.transitionSeconds, repeat: suite.repeat, loop: false, crossfadeSeconds: 0 });
  }
  for (const [id, direction] of Object.entries(pack.musicDirections || {}).slice(0, 8)) {
    if (!direction || typeof direction !== 'object' || Array.isArray(direction)) continue;
    directions[id] = Object.freeze(Object.fromEntries(['home', 'lobby', 'creativeSetup', 'mafiaLobby', 'mafiaNight'].map(key => [key, assets[direction[key]]?.kind === 'music' || suites[direction[key]] ? direction[key] : null])));
  }
  if (options.musicId !== undefined) result.musicId = assets[options.musicId]?.kind === 'music' ? options.musicId : false;
  return finish();
}

export function localAuditionScene(audition, game, phase, ordinary, unavailableTracks) {
  const setup = ['idle', 'intro', 'setup', 'lobby', 'waiting', 'categories', 'category'].includes(phase);
  let slot = null;
  if (game === 'home') slot = 'home';
  else if (game === 'mafia') slot = setup ? 'mafiaLobby' : phase === 'night' ? 'mafiaNight' : null;
  else if (setup) slot = ['ersomha', 'fabraka'].includes(game) ? 'creativeSetup' : 'lobby';
  else if (['over', 'result', 'results', 'roundEnd'].includes(phase)) slot = 'lobby';
  else if (game === 'ersomha' || game === 'fabraka' && phase === 'write') slot = 'creativeSetup';
  if (ordinary.gain === 0) slot = null;
  // An explicitly selected alternative is one identity, not a random mixture.
  // Alternative music stays out of Mafia's limited night/lobby branch.
  const id = slot && (audition.musicId === null ? audition.directions[audition.directionId]?.[slot] : game === 'mafia' ? audition.musicId === 'music-plan' ? audition.musicId : null : audition.musicId);
  const entry = audition.suites?.[id] || audition.assets[id];
  const track = entry && !unavailableTracks.has(entry.url) ? entry : null;
  return { ...ordinary, track, fallback: null, gain: track ? ordinary.gain : 0, pendingAsset: !track, privateCandidate: false, localAudition: true };
}

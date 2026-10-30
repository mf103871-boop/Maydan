// The candidate registry documents selections; only reviewed, packaged local
// assets may be activated. No third-party hotlink, guessed URL or runtime fetch
// of a source page is permitted here.
import { CANDIDATE_SCENES } from './audio-candidate-catalog.js';
import { isPrivateAudioCandidateBuild, validPrivateAudioCandidate } from './audio-candidate-policy.js';
export const AUDIO_SCENES = Object.freeze({
  home: { candidate: 'menus', fallback: 'home', gain: 1 },
  badeeha: { candidate: 'badeeha', fallback: 'calm', gain: 0.8 },
  ersomha: { candidate: 'ersomha', fallback: 'calm', gain: 0.8 },
  fabraka: { candidate: 'fabraka', fallback: 'calm', gain: 0.65 },
  meenfina: { candidate: 'meenfina', fallback: 'calm', gain: 0.65 },
  jabeen: { candidate: 'jabeen', fallback: 'calm', gain: 0.5 },
  mamnoo: { candidate: 'mamnoo', fallback: 'calm', gain: 0.5 },
  beep: { candidate: 'beep', fallback: null, gain: 0.6 },
  mafia: { candidate: 'mafia', fallback: null, gain: 0.55 },
});

// Deliberately empty until source download, license evidence and listening QA
// have all succeeded. Do not silently promote private-testflight-audition.
export const REVIEWED_SCENE_TRACKS = Object.freeze({});

export function resolveAudioScene(game, phase, { creatorMode = false, tracks = REVIEWED_SCENE_TRACKS, unavailableTracks = new Set() } = {}) {
  const scene = AUDIO_SCENES[game] || AUDIO_SCENES.home;
  const silent = creatorMode || (game === 'beep' && ['play', 'bomb', 'three'].includes(phase)) ||
    (game === 'mafia' && ['opening', 'discussion', 'defense'].includes(phase));
  const privateTrack = isPrivateAudioCandidateBuild() ? CANDIDATE_SCENES[game] || CANDIDATE_SCENES.home : null;
  const privateCandidate = validPrivateAudioCandidate(privateTrack) && !unavailableTracks.has(privateTrack.url);
  const track = tracks[scene.candidate];
  const reviewed = track?.listeningApproved === true && track?.licenseVerified === true &&
    /^[a-f\d]{64}$/.test(track.sha256 || '') && /^audio\/[a-z\d/_-]+\.(m4a|mp3|ogg|wav)$/.test(track.url || '') &&
    Number.isFinite(track.seconds) && track.seconds > 0;
  return { game, phase, gain: silent ? 0 : scene.gain, track: silent ? null : privateCandidate ? privateTrack : reviewed ? track : null,
    fallback: silent ? null : scene.fallback, pendingAsset: !reviewed && !privateCandidate,
    privateCandidate: !silent && privateCandidate };
}

export function createSceneLeases(onChange) {
  const owners = new Map(); let sequence = 0;
  const update = () => {
    const top = [...owners.values()].sort((a, b) => b.priority - a.priority || b.order - a.order)[0];
    onChange(top?.scene ?? null);
  };
  return {
    set(owner, scene, priority = 0) { if (owner == null) return; owners.set(owner, { scene, priority, order: ++sequence }); update(); },
    release(owner) { if (owners.delete(owner)) update(); },
    clear() { owners.clear(); update(); },
  };
}

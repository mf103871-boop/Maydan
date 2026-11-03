import { createLocalAudition } from './local-audition.js';
import { isWarmthPreviewBuild } from './warmth-preview-policy.js';

// Configured by the separate local game entry before React mounts. Production
// builds erase this path; neither remote configuration nor query strings can
// turn pending media into reviewed assets.
let configuration = null;
let previewSound = null;
const soundListeners = new Set();
export function registerIntegratedPreviewSound(sound) {
  if (!integratedPreviewAudio()) return () => {};
  previewSound = sound;
  for (const listener of soundListeners) listener(sound);
  return () => {
    if (previewSound !== sound) return;
    previewSound = null;
    for (const listener of soundListeners) listener(null);
  };
}
export function subscribeIntegratedPreviewSound(listener) {
  if (!((typeof __MAYDAN_LOCAL_AUDIO_REVIEW__ !== 'undefined' && __MAYDAN_LOCAL_AUDIO_REVIEW__ === true) || (typeof __MAYDAN_WARMTH_PREVIEW__ !== 'undefined' && __MAYDAN_WARMTH_PREVIEW__ === true))) return () => {};
  soundListeners.add(listener);
  listener(integratedPreviewAudio() ? previewSound : null);
  return () => soundListeners.delete(listener);
}
export function configureIntegratedPreviewAudio({ pack, baseUrl = '/audio-preview/' } = {}) {
  if (!((typeof __MAYDAN_LOCAL_AUDIO_REVIEW__ !== 'undefined' && __MAYDAN_LOCAL_AUDIO_REVIEW__ === true) || (typeof __MAYDAN_WARMTH_PREVIEW__ !== 'undefined' && __MAYDAN_WARMTH_PREVIEW__ === true))) return false;
  const next = { pack, baseUrl, mode: 'candidate', directionId: 'bossaAlternative' };
  const audition = createLocalAudition(next);
  if (!audition) return false;
  // An invalid local pack remains a silent candidate, never the old bank.
  configuration = Object.freeze(next);
  return !!audition.assets['music-bossa'] && Object.keys(audition.bank).length > 0;
}
export function integratedPreviewAudio() {
  if (!((typeof __MAYDAN_LOCAL_AUDIO_REVIEW__ !== 'undefined' && __MAYDAN_LOCAL_AUDIO_REVIEW__ === true) || (typeof __MAYDAN_WARMTH_PREVIEW__ !== 'undefined' && __MAYDAN_WARMTH_PREVIEW__ === true))) return undefined;
  // Recheck origin: holding a stale configuration must not expand its scope.
  if (configuration && createLocalAudition(configuration)) return configuration;
  // A missing/malformed preview configuration is silent, never the legacy bank.
  return isWarmthPreviewBuild() ? { mode: 'candidate', directionId: 'bossaAlternative', baseUrl: '/audio-warmth-preview/', pack: null } : undefined;
}
export function integratedPreviewDefaults() {
  return integratedPreviewAudio() ? { soundVolume: 0.65, musicVolume: 0.30, voiceOn: false } : {};
}

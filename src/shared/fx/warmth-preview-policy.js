import { isPrivateAudioCandidateBuild } from './audio-candidate-policy.js';
import { MAFIA_PREVIEW_API_ORIGIN } from '../lib/environment.js';

// User-approved listening identity. Device testing and public release approval
// remain separate; this guard must never promote either reviewed asset registry.
export const WARMTH_SOURCE_MANIFEST_SHA256 = '26a1737edc78602489fc7a746c1ee199d65066614312b621648da24f1f207c56';
export function isWarmthPreviewBuild() {
  return typeof __MAYDAN_WARMTH_PREVIEW__ !== 'undefined' && __MAYDAN_WARMTH_PREVIEW__ === true && isPrivateAudioCandidateBuild();
}
export function warmthPreviewLocation(url) {
  return isWarmthPreviewBuild() && !url.username && !url.password &&
    ((url.protocol === 'maydan:' && url.host === 'app') || url.origin === MAFIA_PREVIEW_API_ORIGIN);
}
export function audioAuditionBuildEnabled() {
  return (typeof __MAYDAN_LOCAL_AUDIO_REVIEW__ !== 'undefined' && __MAYDAN_LOCAL_AUDIO_REVIEW__ === true) || isWarmthPreviewBuild();
}

import { callNative, isNativeShell } from './native.js';
import { request } from './api.js';
import { socialInterruption } from '../../social/interruption.js';
import { activeAudioOwners } from '../../social/media.js';
import { environmentStorageKey } from '../lib/environment.js';
import { BADEEHA_KEYS } from '../../games/badeeha/keys.js';

export const REWARDED_PREVIEW = typeof __MAYDAN_REWARDED_PREVIEW__ !== 'undefined' && __MAYDAN_REWARDED_PREVIEW__ === true;
export const BADEEHA_REWARDED_PACKS = Object.freeze(['general','geo','capitals','science','animals','history']);
export const LOCAL_REWARDED_OFFER = 'badeeha-demo';
export const ROOM_REWARDED_OFFER = 'meenfina-demo';
export const rewardedStatus = (account, offer) => account.requestAuthenticated('/api/rewarded/status?offer=' + encodeURIComponent(offer));
export const rewardedStart = (account, matchId) => account.requestAuthenticated('/api/rewarded/local-start', {
  method: 'POST', body: { offer: LOCAL_REWARDED_OFFER, matchId },
});
export const rewardedConfig = () => request('/api/rewarded/config');
export const rewardedStorageKey = (owner, key = BADEEHA_KEYS.active) =>
  environmentStorageKey(`maydan:rewarded:${encodeURIComponent(owner)}:${key}`);
export function hasRewardedDraft(owner) {
  try { return Boolean(owner && localStorage.getItem(rewardedStorageKey(owner))); }
  catch { return false; }
}
export function rewardEvent(offer, event) {
  if (typeof __MAYDAN_REWARDED_SIMULATION__ !== 'undefined' && __MAYDAN_REWARDED_SIMULATION__ &&
      location.hostname === '127.0.0.1') window.maydanRewardedMetric?.({ offer, event });
}

export function rewardedSurfaceSafe(surface) {
  const route = location.hash.split('?')[0];
  const state = socialInterruption.getSnapshot();
  const editing = document.activeElement?.matches('input, textarea, select, [contenteditable="true"]');
  const dialog = document.querySelector('[aria-modal="true"], dialog[open]');
  return !document.hidden && navigator.onLine !== false && !editing && !dialog && !activeAudioOwners().length &&
    !state.open && !state.privateTurn && !state.paused && !state.communicationLocked && !state.turnDeadline &&
    (surface === 'room-lobby' ? /^#\/room\/\d{6}$/.test(route) && state.online :
      (route === '#/game/badeeha' || route === '#/online/meenfina') && !state.local && !state.online);
}

// Mock display exists only in the Node preview entry. The shipped client has
// no simulator endpoint or permission to claim a reward from a native callback.
export async function presentRewarded(attempt) {
  if (attempt.mode === 'native' && location.protocol === 'maydan:' && isNativeShell()) {
    return callNative('rewardedShow', { customData: attempt.customData, adUnit: attempt.adUnit, expiresAt: attempt.expiresAt }, { timeout: 180000 });
  }
  if (typeof __MAYDAN_REWARDED_SIMULATION__ !== 'undefined' && __MAYDAN_REWARDED_SIMULATION__ &&
      attempt.mode === 'simulation' && location.hostname === '127.0.0.1' && typeof window.maydanRewardedLab === 'function') {
    return window.maydanRewardedLab(attempt.attemptId);
  }
  return { state: 'unavailable', presented: false };
}

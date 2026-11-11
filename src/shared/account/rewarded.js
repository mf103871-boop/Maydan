import { callNative, isNativeShell } from './native.js';
import { request } from './api.js';
import { socialInterruption } from '../../social/interruption.js';
import { activeAudioOwners } from '../../social/media.js';
import { environmentStorageKey } from '../lib/environment.js';
import { BADEEHA_KEYS } from '../../games/badeeha/keys.js';
import { isAndroidRewardedShell, callAndroidRewarded } from './android-rewarded.js';
import { gameplayEntryOffer, ENTRY_POLICY } from './gameplay-policy.mjs';

export const REWARDED_PREVIEW = typeof __MAYDAN_REWARDED_PREVIEW__ !== 'undefined' && __MAYDAN_REWARDED_PREVIEW__ === true;
export const BADEEHA_REWARDED_PACKS = Object.freeze(['general','geo','capitals','science','animals','history']);
export const LOCAL_REWARDED_OFFER = 'badeeha-demo';
export const ROOM_REWARDED_OFFER = 'meenfina-demo';
export const rewardedStatus = (account, offer) => account.requestAuthenticated('/api/rewarded/status?offer=' + encodeURIComponent(offer));
export async function rewardedEntryStatus(account, game) {
  const offer = gameplayEntryOffer(game);
  if (!offer) throw new Error('Unknown game entry');
  const next = await account.requestAuthenticated('/api/rewarded/entry-status?game=' + encodeURIComponent(game), { gameplayCapability: 2 });
  const states = ['plus', 'trial', 'ticket', 'required', 'busy'];
  if (next?.game !== game || next.offer !== offer.id || next.policy !== ENTRY_POLICY || !states.includes(next.access) ||
    !next.modeAccess || Object.keys(next.modeAccess).sort().join() !== [...offer.modes].sort().join() ||
    !Object.values(next.modeAccess).every(value => states.includes(value))) throw new Error('Incompatible game entry status');
  return next;
}
export const rewardedStart = (account, matchId, offer = LOCAL_REWARDED_OFFER) => account.requestAuthenticated('/api/rewarded/local-start', {
  method: 'POST', body: { offer, matchId }, gameplayCapability: 2,
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
    (surface === 'game-entry' ? /^#\/entry\/(badeeha|beep|mamnoo|jabeen|fabraka|meenfina|ersomha|mafia)$/.test(route) && !state.local && !state.online :
      surface === 'room-lobby' ? /^#\/room\/\d{6}$/.test(route) && state.online :
      surface === 'local-start' ? /^#\/play\/(badeeha|beep|mamnoo|jabeen|fabraka|meenfina)$/.test(route) && !state.local && !state.online :
      /^#\/(game\/badeeha|online\/(badeeha|meenfina|fabraka|ersomha|mafia))$/.test(route) && !state.local && !state.online);
}

// Mock display exists only in the Node preview entry. The shipped client has
// no simulator endpoint or permission to claim a reward from a native callback.
export async function presentRewarded(attempt, options = {}) {
  if (attempt.mode === 'android-native' && isAndroidRewardedShell()) {
    return callAndroidRewarded('rewardedShow', { customData: attempt.customData, adUnit: attempt.adUnit, expiresAt: attempt.expiresAt }, options);
  }
  if (attempt.mode === 'native' && location.protocol === 'maydan:' && isNativeShell()) {
    return callNative('rewardedShow', { customData: attempt.customData, adUnit: attempt.adUnit, expiresAt: attempt.expiresAt }, { timeout: 180000 });
  }
  if (typeof __MAYDAN_REWARDED_SIMULATION__ !== 'undefined' && __MAYDAN_REWARDED_SIMULATION__ &&
      attempt.mode === 'simulation' && location.hostname === '127.0.0.1' && typeof window.maydanRewardedLab === 'function') {
    return window.maydanRewardedLab(attempt.attemptId);
  }
  return { state: 'unavailable', presented: false };
}

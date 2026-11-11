import { FREE_PACKS } from './config.js';

export const TICKET_POLICY = 'trial-ticket-v1';
export const ENTRY_POLICY = 'game-entry-ticket-v2';
export const ENTRY_TICKET_POLICY = ENTRY_POLICY;
export const GAMEPLAY_ACCESS_CAPABILITY = 2;
export const entryPolicyEnabled = value => value === ENTRY_POLICY;
export const ticketPolicyEnabled = value => value === TICKET_POLICY || entryPolicyEnabled(value);
export function resolveGameplayPolicy({ billing, me, build } = {}) {
  // billing is a fresh public response; the cached /me from the last free
  // build cannot disable a deliberately gated native build while offline.
  if (billing?.gameplay?.access === 'free' && !billing.gameplay.policy) return null;
  if (ticketPolicyEnabled(billing?.gameplay?.policy)) return billing.gameplay.policy;
  const policies = [me?.gameplay?.policy, build];
  return policies.some(entryPolicyEnabled) ? ENTRY_POLICY : policies.some(ticketPolicyEnabled) ? TICKET_POLICY : null;
}

const games = [
  ['badeeha', 'بديهة', ['local', 'online']],
  ['beep', 'قبل ما يطق!', ['local']],
  ['mamnoo', 'ممنوع!', ['local']],
  ['jabeen', 'على جبينك', ['local']],
  ['fabraka', 'فبركة', ['local', 'online']],
  ['meenfina', 'مين فينا', ['local', 'online']],
  ['ersomha', 'ارسمها', ['online']],
  ['mafia', 'مافيا ميدان', ['online']],
];

export const GAMEPLAY_OFFERS = Object.freeze(games.flatMap(([game, label, modes]) =>
  modes.map(mode => Object.freeze({ id: `${game}-${mode}`, game, mode, label }))));
export const gameplayOffer = (game, mode) =>
  GAMEPLAY_OFFERS.find(offer => offer.game === game && offer.mode === mode) || null;
export const gameplayOfferById = id => GAMEPLAY_OFFERS.find(offer => offer.id === id) || null;
export const GAMEPLAY_ENTRY_OFFERS = Object.freeze(games.map(([game, label, modes]) =>
  Object.freeze({ id: `${game}-entry-v2`, game, label, mode: 'entry', modes: Object.freeze([...modes]) })));
export const gameplayEntryOffer = game => GAMEPLAY_ENTRY_OFFERS.find(offer => offer.game === game) || null;
export const gameplayEntryOfferById = id => GAMEPLAY_ENTRY_OFFERS.find(offer => offer.id === id) || null;
export const badeehaFreeSelection = (categories, policy = TICKET_POLICY) =>
  !entryPolicyEnabled(policy) && Array.isArray(categories) && categories.length > 0 && categories.every(id => FREE_PACKS.includes(id));

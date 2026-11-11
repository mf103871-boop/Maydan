import { FREE_PACKS } from './config.js';

export const TICKET_POLICY = 'trial-ticket-v1';
export const ticketPolicyEnabled = value => value === TICKET_POLICY;
export function resolveGameplayPolicy({ billing, me, build } = {}) {
  // billing is a fresh public response; the cached /me from the last free
  // build cannot disable a deliberately gated native build while offline.
  if (billing?.gameplay?.access === 'free' && !billing.gameplay.policy) return null;
  return [billing?.gameplay?.policy, me?.gameplay?.policy, build].some(ticketPolicyEnabled) ? TICKET_POLICY : null;
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
export const badeehaFreeSelection = categories =>
  Array.isArray(categories) && categories.length > 0 && categories.every(id => FREE_PACKS.includes(id));

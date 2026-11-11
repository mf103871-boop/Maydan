import freeQuestions from '../data/badeeha-free-manifest.json' with { type: 'json' };
import { badeehaFreeSelection } from '../../src/shared/account/gameplay-policy.mjs';

const questions = new Map(Object.entries(freeQuestions).map(([category, ids]) => [category, new Set(ids)]));

export function freeBadeehaRoom(settings) {
  if (!badeehaFreeSelection(settings?.categories) || !settings.deck || typeof settings.deck !== 'object') return false;
  // Category labels are supplied by the host, so they are insufficient. Every
  // referenced question must belong to that exact free category in our bank.
  return settings.categories.every(category => Array.isArray(settings.deck[category]) &&
    settings.deck[category].every(cell => questions.get(category)?.has(cell?.qid)));
}

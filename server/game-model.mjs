// Missing game IDs belong to the original rooms. Their state and protocol stay valid.
import * as meenfina from './room-model.mjs';
import * as fabraka from './fabraka-model.mjs';
import * as ersomha from './ersomha-model.mjs';
import * as badeeha from './badeeha-model.mjs';
import * as mafia from './mafia-model.mjs';
import { roomContentIdentity, requireContentCapability, recordContentCapability, changeRoomContent } from './content-locale.mjs';
export { member, memberOrNull, RoomError, fail } from './room-model.mjs';
const models = { meenfina, fabraka, ersomha, badeeha, mafia };
const model = room => models[room.game || 'meenfina'] || meenfina.fail('GAME');
export const roomCapacity = room => room.game === 'mafia' ? room.settings.capacity : room.game === 'badeeha' ? 4 : room.game === 'fabraka' || room.game === 'ersomha' ? 8 : 12;
export function createRoom(code, input, now) {
  const game = input.game ?? 'meenfina';
  if (!Object.hasOwn(models, game)) meenfina.fail('GAME');
  const identity = requireContentCapability(input.capabilities, input);
  const localizedInput = { ...input, ...identity, ...(game === 'mafia' ? { settings: { ...input.settings, community: identity.contentLocale } } : {}) };
  const room = { ...models[game].createRoom(code, localizedInput, now), game, ...identity };
  recordContentCapability(room, input.id, input.capabilities);
  return room;
}
export function joinRoom(room, input, now) {
  requireContentCapability(input.capabilities, room);
  const result = model(room).joinRoom(room, input, now);
  recordContentCapability(room, input.id, input.capabilities);
  return result;
}
export const leaveRoom = (room, id, now) => model(room).leaveRoom(room, id, now);
export function connected(room, id, value, now) {
  if (room.game === 'mafia') return mafia.connected(room,id,value,now);
  meenfina.connected(room, id, value, now);
  if (room.game === 'ersomha') ersomha.tick(room, now);
}
export function action(room, id, command, now, deck) {
  if (command.type === 'content_locale') {
    const candidate = structuredClone(room);
    const changed = changeRoomContent(candidate, id, command);
    const nextIdentity = roomContentIdentity(command);
    const nextSettings = changed && room.game === 'badeeha' ? badeeha.normalizeSettings(command.settings) : null;
    if (nextSettings) badeeha.validateLocalizedDeck(nextSettings, nextIdentity);
    if (changed && room.game === 'badeeha') {
      // A deck cannot silently keep the other language. The caller supplies a
      // freshly built pack in the same transaction as the language selection.
      candidate.settings = nextSettings;
    }
    if (changed && room.game === 'ersomha') candidate.settings = ersomha.normalizeErsomhaSettings({ ...room.settings, categories: [] }, candidate.contentLocale);
    if (changed && room.game === 'fabraka') candidate.settings.categories = [];
    Object.assign(room, candidate);
    return;
  }
  const identity = roomContentIdentity(room);
  if (command.type === 'start' && identity.contentLocale === 'en' && room.members.some(seat => !seat.left && !seat.localizedContent)) meenfina.fail('UPDATE_REQUIRED', 409);
  const effectiveCommand = room.game === 'mafia' && command.type === 'settings' ? { ...command, settings: { ...command.settings, community: identity.contentLocale } } : command;
  const result = model(room).action(room, id, effectiveCommand, now, deck);
  Object.assign(room, identity);
  return result;
}
export const tick = (room, now) => model(room).tick(room, now);
export const nextAlarm = (room, now) => model(room).nextAlarm(room, now);
export const snapshot = (room, id, now) => ({ ...model(room).snapshot(room, id, now), game: room.game || 'meenfina',
  ...roomContentIdentity(room),
  capabilities: { localizedContent: 1 },
  ...(room.directory ? { directory: { visibility: room.directory.visibility, ...(room.directory.name ? { name: room.directory.name } : {}) } } : {}),
  trialStarted: Boolean(room.trialStarted), ...(room.trialOwnerId ? { trialOwnerId: room.trialOwnerId } : {}) });

// Missing game IDs belong to the original rooms. Their state and protocol stay valid.
import * as meenfina from './room-model.mjs';
import * as fabraka from './fabraka-model.mjs';
import * as ersomha from './ersomha-model.mjs';
export { member, memberOrNull, RoomError, fail } from './room-model.mjs';
const models = { meenfina, fabraka, ersomha };
const model = room => models[room.game || 'meenfina'] || meenfina.fail('GAME');
export const roomCapacity = room => room.game === 'fabraka' || room.game === 'ersomha' ? 8 : 12;
export function createRoom(code, input, now) {
  const game = input.game ?? 'meenfina';
  if (!Object.hasOwn(models, game)) meenfina.fail('GAME');
  return { ...models[game].createRoom(code, input, now), game };
}
export const joinRoom = (room, input, now) => model(room).joinRoom(room, input, now);
export const leaveRoom = (room, id, now) => model(room).leaveRoom(room, id, now);
export function connected(room, id, value, now) {
  meenfina.connected(room, id, value, now);
  if (room.game === 'ersomha') ersomha.tick(room, now);
}
export const action = (room, id, command, now, deck) => model(room).action(room, id, command, now, deck);
export const tick = (room, now) => model(room).tick(room, now);
export const nextAlarm = (room, now) => model(room).nextAlarm(room, now);
export const snapshot = (room, id, now) => ({ ...model(room).snapshot(room, id, now), game: room.game || 'meenfina',
  trialStarted: Boolean(room.trialStarted), ...(room.trialOwnerId ? { trialOwnerId: room.trialOwnerId } : {}) });

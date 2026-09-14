// Missing game IDs belong to the original rooms. Their state and protocol stay valid.
import * as meenfina from './room-model.mjs';
import * as fabraka from './fabraka-model.mjs';
export { member, memberOrNull, RoomError, fail, connected } from './room-model.mjs';
const model = (room) => room.game === 'fabraka' ? fabraka : meenfina;
export function createRoom(code, input, now) {
  const game = input.game ?? 'meenfina';
  if (!['meenfina', 'fabraka'].includes(game)) meenfina.fail('GAME');
  return { ...(game === 'fabraka' ? fabraka : meenfina).createRoom(code, input, now), game };
}
export const joinRoom = (room, input, now) => model(room).joinRoom(room, input, now);
export const leaveRoom = (room, id, now) => model(room).leaveRoom(room, id, now);
export const action = (room, id, command, now, deck) => model(room).action(room, id, command, now, deck);
export const tick = (room, now) => model(room).tick(room, now);
export const nextAlarm = (room, now) => model(room).nextAlarm(room, now);
export const snapshot = (room, id, now) => ({ ...model(room).snapshot(room, id, now), game: room.game || 'meenfina' });

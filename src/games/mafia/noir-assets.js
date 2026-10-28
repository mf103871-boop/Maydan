import icon from './assets/noir-spy.webp';
import roles from './assets/noir-roles.webp';
import scenes from './assets/noir-scenes-wide.webp';
import environment from './assets/noir-environment.webp';
import cardBack from './assets/noir-card-back.webp';

// Imported assets use the same content-hashed/offline/native pipeline as Maydan's
// existing brand art. Public illustrations contain no role assignments or clues.
export const MAFIA_NOIR_ASSETS = Object.freeze({ icon, roles, scenes, environment, cardBack });
export const MAFIA_NOIR_ROLE_INDEX = Object.freeze({ citizen: 0, investigator: 1, doctor: 2, guard: 3, observer: 4, reporter: 5, herald: 6, analyst: 7, mafia: 8, masker: 9, blocker: 10, leader: 11 });
export const MAFIA_NOIR_SCENE_INDEX = Object.freeze({ night: 0, dawn: 1, investigation: 2, elimination: 3, verdict: 4, ending: 5, deal: 6, lobby: 7 });

function frameStyle(url, width, height, x, y, w, h) {
  return { backgroundImage: `url(${url})`, backgroundRepeat: 'no-repeat', backgroundSize: `${width / w * 100}% ${height / h * 100}%`, backgroundPosition: `${x / (width - w) * 100}% ${y / (height - h) * 100}%`, aspectRatio: `${w} / ${h}` };
}
export function mafiaRoleArtStyle(roleId) {
  const index = MAFIA_NOIR_ROLE_INDEX[roleId];
  // Unknown roles never silently acquire the illustration of a real role.
  if (!Number.isInteger(index)) return { backgroundImage: `url(${icon})`, backgroundPosition: 'center', backgroundRepeat: 'no-repeat', backgroundSize: 'contain', aspectRatio: '1' };
  const columns = [0, 313, 626, 940, 1254], rows = [0, 396, 802, 1254];
  const col = index % 4, row = Math.floor(index / 4);
  return frameStyle(roles, 1254, 1254, columns[col], rows[row], columns[col + 1] - columns[col], rows[row + 1] - rows[row]);
}
export function mafiaSceneArtStyle(sceneId) {
  const requested = MAFIA_NOIR_SCENE_INDEX[sceneId];
  const index = Number.isInteger(requested) ? requested : MAFIA_NOIR_SCENE_INDEX.night;
  // Explicit reviewed cell edges prevent neighboring events bleeding at odd atlas dimensions.
  const columns = [0, 591, 1182], rows = [0, 333, 665, 998, 1330];
  const col = index % 2, row = Math.floor(index / 2);
  return frameStyle(scenes, 1182, 1330, columns[col], rows[row], columns[col + 1] - columns[col], rows[row + 1] - rows[row]);
}

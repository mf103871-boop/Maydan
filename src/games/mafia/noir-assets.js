import icon from './assets/noir-spy.webp';
import roles from './assets/noir-roles.webp';
import scenes from './assets/noir-scenes.webp';
import environment from './assets/noir-environment.webp';

// Imported assets use the same content-hashed/offline/native pipeline as Maydan's
// existing brand art. Public illustrations contain no role assignments or clues.
export const MAFIA_NOIR_ASSETS = Object.freeze({ icon, roles, scenes, environment });
export const MAFIA_NOIR_ROLE_INDEX = Object.freeze({ citizen: 0, investigator: 1, doctor: 2, guard: 3, observer: 4, reporter: 5, herald: 6, analyst: 7, mafia: 8, masker: 9, blocker: 10, leader: 11 });
export const MAFIA_NOIR_SCENE_INDEX = Object.freeze({ night: 0, dawn: 1, investigation: 2, elimination: 3, verdict: 4, ending: 5 });

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
  const index = MAFIA_NOIR_SCENE_INDEX[sceneId] ?? MAFIA_NOIR_SCENE_INDEX.night;
  return frameStyle(scenes, 1024, 1536, index % 2 * 512, Math.floor(index / 2) * 512, 512, 512);
}

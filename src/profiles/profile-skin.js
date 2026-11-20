import { getCosmetic } from '../plus/catalog.js';
import sahraPanorama from '../shared/brand/assets/playful-cosmetics/panorama.webp';
import { cssAssetUrl } from '../shared/ui/css-asset-url.js';
export function profileSkin(cosmetics) { return getCosmetic(cosmetics?.profileSkinId,{kind:'profileSkin'}); }
export const profileSkinArt = id => id === 'sahra.profileSkin' ? sahraPanorama : null;
export function profileSkinStyle(cosmetics) {
  return profileSkin(cosmetics)?.id==='sahra.profileSkin'?{
    '--profile-accent':'#08796d','--profile-soft':'#e0f1e8','--profile-deep':'#28524b',
    '--profile-gradient':'linear-gradient(135deg,#e0f1e8,#fff3d8)',
    '--profile-skin-panorama':cssAssetUrl(sahraPanorama),
  }:{};
}

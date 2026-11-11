import { getCosmetic } from '../plus/catalog.js';
export function profileSkin(cosmetics) { return getCosmetic(cosmetics?.profileSkinId,{kind:'profileSkin'}); }
export function profileSkinStyle(cosmetics) {
  return profileSkin(cosmetics)?.id==='sahra.profileSkin'?{
    '--profile-accent':'#f1c56f','--profile-soft':'#244c4d','--profile-deep':'#ffe1a1',
    '--profile-gradient':'linear-gradient(135deg,#153d43,#3e2c48)',
    '--profile-skin-art':'url("/assets/plus/v2/profile-sahra-background.webp")',
  }:{};
}

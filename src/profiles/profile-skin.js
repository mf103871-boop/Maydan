import { getCosmetic } from '../plus/catalog.js';
import sahraGarland from '../shared/brand/assets/playful-profile/sahra-garland-v1.webp';
import { cssAssetUrl } from '../shared/ui/css-asset-url.js';
export function profileSkin(cosmetics) { return getCosmetic(cosmetics?.profileSkinId,{kind:'profileSkin'}); }
export function profileSkinStyle(cosmetics) {
  return profileSkin(cosmetics)?.id==='sahra.profileSkin'?{
    '--profile-accent':'#f1c56f','--profile-soft':'#244c4d','--profile-deep':'#ffe1a1',
    '--profile-gradient':'linear-gradient(135deg,#153d43,#3e2c48)',
    '--profile-skin-garland':cssAssetUrl(sahraGarland),
  }:{};
}

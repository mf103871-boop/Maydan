import avatar0_128 from './assets/legacy-identities/legacy-avatar-0-v1-128.webp';
import avatar0_256 from './assets/legacy-identities/legacy-avatar-0-v1-256.webp';
import avatar0_512 from './assets/legacy-identities/legacy-avatar-0-v1-512.webp';
import avatar1_128 from './assets/legacy-identities/legacy-avatar-1-v1-128.webp';
import avatar1_256 from './assets/legacy-identities/legacy-avatar-1-v1-256.webp';
import avatar1_512 from './assets/legacy-identities/legacy-avatar-1-v1-512.webp';
import avatar2_128 from './assets/legacy-identities/legacy-avatar-2-v1-128.webp';
import avatar2_256 from './assets/legacy-identities/legacy-avatar-2-v1-256.webp';
import avatar2_512 from './assets/legacy-identities/legacy-avatar-2-v1-512.webp';
import avatar3_128 from './assets/legacy-identities/legacy-avatar-3-v1-128.webp';
import avatar3_256 from './assets/legacy-identities/legacy-avatar-3-v1-256.webp';
import avatar3_512 from './assets/legacy-identities/legacy-avatar-3-v1-512.webp';

// Approved individual portraits retain the legacy index and saved emoji contract.
const ART = [
  {128:avatar0_128,256:avatar0_256,512:avatar0_512},
  {128:avatar1_128,256:avatar1_256,512:avatar1_512},
  {128:avatar2_128,256:avatar2_256,512:avatar2_512},
  {128:avatar3_128,256:avatar3_256,512:avatar3_512},
];
export const LEGACY_AVATAR_URLS = Object.freeze(ART.map(item => item[256]));
export function getLegacyAvatarArt(index, cssSize = 96) {
  const size = cssSize > 128 ? 512 : cssSize > 64 ? 256 : 128;
  return (ART[index] || ART[0])[size];
}

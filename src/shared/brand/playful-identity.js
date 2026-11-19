import compassBadge256 from './assets/playful-identity/badge-compass-256.webp';
import compassBadge128 from './assets/playful-identity/badge-compass-128.webp';
import starBadge256 from './assets/playful-identity/badge-star-256.webp';
import starBadge128 from './assets/playful-identity/badge-star-128.webp';
import trophyBadge256 from './assets/playful-identity/badge-trophy-256.webp';
import trophyBadge128 from './assets/playful-identity/badge-trophy-128.webp';
import onlineBadge256 from './assets/playful-profile/badge-online-v1-256.webp';
import onlineBadge128 from './assets/playful-profile/badge-online-v1-128.webp';
import hostingBadge256 from './assets/playful-profile/badge-hosting-v1-256.webp';
import hostingBadge128 from './assets/playful-profile/badge-hosting-v1-128.webp';
import friendsBadge256 from './assets/playful-profile/badge-friends-v1-256.webp';
import friendsBadge128 from './assets/playful-profile/badge-friends-v1-128.webp';
import identityBadge256 from './assets/playful-profile/badge-identity-v1-256.webp';
import identityBadge128 from './assets/playful-profile/badge-identity-v1-128.webp';
import onlineBadge from './assets/playful-profile/badge-online-v1.webp';
import hostingBadge from './assets/playful-profile/badge-hosting-v1.webp';
import friendsBadge from './assets/playful-profile/badge-friends-v1.webp';
import identityBadge from './assets/playful-profile/badge-identity-v1.webp';
// Approved B identity artwork. IDs and entitlement rules live in the shared catalogs.
import sparkSmall from './assets/playful-identity/avatar-spark-128.webp';
import sparkMedium from './assets/playful-identity/avatar-spark-256.webp';
import sparkLarge from './assets/playful-identity/avatar-spark.webp';
import falconSmall from './assets/playful-identity/avatar-falcon-128.webp';
import falconMedium from './assets/playful-identity/avatar-falcon-256.webp';
import falconLarge from './assets/playful-identity/avatar-falcon.webp';
import lionSmall from './assets/playful-identity/avatar-lion-128.webp';
import lionMedium from './assets/playful-identity/avatar-lion-256.webp';
import lionLarge from './assets/playful-identity/avatar-lion.webp';
import foxSmall from './assets/playful-identity/avatar-fox-128.webp';
import foxMedium from './assets/playful-identity/avatar-fox-256.webp';
import foxLarge from './assets/playful-identity/avatar-fox.webp';
import owlSmall from './assets/playful-identity/avatar-owl-128.webp';
import owlMedium from './assets/playful-identity/avatar-owl-256.webp';
import owlLarge from './assets/playful-identity/avatar-owl.webp';
import catSmall from './assets/playful-identity/avatar-cat-128.webp';
import catMedium from './assets/playful-identity/avatar-cat-256.webp';
import catLarge from './assets/playful-identity/avatar-cat.webp';
import rocketSmall from './assets/playful-identity/avatar-rocket-128.webp';
import rocketMedium from './assets/playful-identity/avatar-rocket-256.webp';
import rocketLarge from './assets/playful-identity/avatar-rocket.webp';
import controllerSmall from './assets/playful-identity/avatar-controller-128.webp';
import controllerMedium from './assets/playful-identity/avatar-controller-256.webp';
import controllerLarge from './assets/playful-identity/avatar-controller.webp';
import human_01Small from './assets/playful-identity/avatar-human-01-128.webp';
import human_01Medium from './assets/playful-identity/avatar-human-01-256.webp';
import human_01Large from './assets/playful-identity/avatar-human-01.webp';
import human_02Small from './assets/playful-identity/avatar-human-02-128.webp';
import human_02Medium from './assets/playful-identity/avatar-human-02-256.webp';
import human_02Large from './assets/playful-identity/avatar-human-02.webp';
import human_03Small from './assets/playful-identity/avatar-human-03-128.webp';
import human_03Medium from './assets/playful-identity/avatar-human-03-256.webp';
import human_03Large from './assets/playful-identity/avatar-human-03.webp';
import human_04Small from './assets/playful-identity/avatar-human-04-128.webp';
import human_04Medium from './assets/playful-identity/avatar-human-04-256.webp';
import human_04Large from './assets/playful-identity/avatar-human-04.webp';
import sahraFrame from './assets/playful-identity/frame-sahra.webp';
import artistFrame from './assets/playful-identity/frame-artist.webp';
import trophyBadge from './assets/playful-identity/badge-trophy.webp';
import starBadge from './assets/playful-identity/badge-star.webp';
import compassBadge from './assets/playful-identity/badge-compass.webp';
const avatars = {
  'spark': [sparkSmall, sparkMedium, sparkLarge],
  'falcon': [falconSmall, falconMedium, falconLarge],
  'lion': [lionSmall, lionMedium, lionLarge],
  'fox': [foxSmall, foxMedium, foxLarge],
  'owl': [owlSmall, owlMedium, owlLarge],
  'cat': [catSmall, catMedium, catLarge],
  'rocket': [rocketSmall, rocketMedium, rocketLarge],
  'controller': [controllerSmall, controllerMedium, controllerLarge],
  'human-01': [human_01Small, human_01Medium, human_01Large],
  'human-02': [human_02Small, human_02Medium, human_02Large],
  'human-03': [human_03Small, human_03Medium, human_03Large],
  'human-04': [human_04Small, human_04Medium, human_04Large],
};
const badgeSizes = {identity:[identityBadge128,identityBadge256,identityBadge],friends:[friendsBadge128,friendsBadge256,friendsBadge],hosting:[hostingBadge128,hostingBadge256,hostingBadge],online:[onlineBadge128,onlineBadge256,onlineBadge],trophy:[trophyBadge128,trophyBadge256,trophyBadge],star:[starBadge128,starBadge256,starBadge],compass:[compassBadge128,compassBadge256,compassBadge]};
const badges = { identity:badgeSizes.identity, 'first-friend':badgeSizes.friends, circle:badgeSizes.friends, host:badgeSizes.hosting, gatherings:badgeSizes.hosting, 'online-start':badgeSizes.online, 'online-ten':badgeSizes.online, welcome: badgeSizes.star, 'first-win': badgeSizes.trophy, 'five-wins': badgeSizes.star, 'twenty-five-wins': badgeSizes.trophy, explorer: badgeSizes.compass, 'all-games': badgeSizes.compass };
const frames = { 'sahra.frame': sahraFrame, 'artist.frame': artistFrame };
const backgrounds = {
  spark:'#B9E4D8', falcon:'#E4CFEA', lion:'#F7B2A3', fox:'#B9E4D8',
  owl:'#E4CFEA', cat:'#F6B89E', rocket:'#B9E4D8', controller:'#E4CFEA',
  'human-01':'#F4B19D', 'human-02':'#B9E4D8', 'human-03':'#E4CFEA', 'human-04':'#F6C8B5',
};

export const getAvatarArt = (id, size = 128) => avatars[id]?.[size <= 64 ? 0 : size <= 128 ? 1 : 2] || null;
export const getBadgeArt = (id, cssSize = 88) => badges[id]?.[cssSize <= 64 ? 0 : cssSize <= 128 ? 1 : 2] || null;
export const getFrameArt = id => frames[id] || null;
export const getAvatarBackground = id => backgrounds[id] || backgrounds.spark;

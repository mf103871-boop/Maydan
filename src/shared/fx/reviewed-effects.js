// Engineering delivery only. Populate after official download, license evidence,
// content hashing and human listening review. Unknown/missing assets stay silent.
export const REVIEWED_EFFECT_ASSETS = Object.freeze([]);
const ALLOWED = new Set(['mafiaAssassination', 'mafiaJudgment']);
export function reviewedEffectBank(entries = REVIEWED_EFFECT_ASSETS) {
  return Object.fromEntries(entries.filter(item => ALLOWED.has(item?.cue) &&
    item.licenseVerified === true && item.listeningApproved === true &&
    /^[a-f\d]{64}$/.test(item.sha256 || '') &&
    /^audio\/[a-z\d/_-]+\.(m4a|mp3|ogg|wav)$/.test(item.url || '') &&
    Number.isSafeInteger(item.frames) && item.frames > 0 && item.frames <= 48000 * 5 &&
    Number.isSafeInteger(item.bytes) && item.bytes > 0 && item.bytes <= 1024 * 1024
  ).map(item => [item.cue, Object.freeze({ ...item })]));
}

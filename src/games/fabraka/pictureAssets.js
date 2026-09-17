// Only neutral, local identifiers may travel to a player before the reveal.
// Never derive a filename, caption or alt text from the answer/source URL.
export const PICTURE_ASSET_PATTERN = /^media\/fabraka-v3\/fab3-\d{3}\.webp$/;
export const PICTURE_CREDIT = 'تصوير توضيحي مولّد بالذكاء الاصطناعي لأداة حقيقية';
export const pictureAsset = (question) => typeof question?.image === 'string'
  && PICTURE_ASSET_PATTERN.test(question.image) ? question.image : null;

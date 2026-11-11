export const PROGRESSION_FRAMES = Object.freeze([
  [1, 'بداية الرحلة'],
  [10, 'صديق الميدان'],
  [20, 'نجم الجلسات'],
  [30, 'صانع الأجواء'],
  [40, 'نجم الميدان'],
  [50, 'رحّالة الميدان'],
  [60, 'النجمة الشرقية'],
].map(([level, title]) => {
  const assetUrl = `/assets/progression/v1/frame-${level}.webp`;
  return Object.freeze({
    id: `progression.frame.${level}`,
    level, title, label: `إطار ${title}`,
    kind: 'frame', entitlement: 'progression', ownership: 'permanent',
    assetUrl, posterUrl: assetUrl, availableFrom: 0, fallback: 'default',
    frameAssets: Object.freeze({ small: `/assets/progression/v1/frame-${level}-small.webp`, medium: assetUrl, large: assetUrl }),
  });
}));
const FRAMES_BY_ID = new Map(PROGRESSION_FRAMES.map(frame => [frame.id, frame]));
export const getProgressionFrame = id => FRAMES_BY_ID.get(id) || null;

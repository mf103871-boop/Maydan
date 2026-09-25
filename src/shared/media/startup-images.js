import { CATS } from '../../data/categories/index.js';
import fabrakaPictures from '../../data/games/fabraka/pictures.json' with { type: 'json' };
import { categoryCoverSource } from '../../games/badeeha/covers.js';
import { pictureAsset } from '../../games/fabraka/pictureAssets.js';
import { mediaKind, questionMedia, resolveMedia } from './resolve.js';

// Follow the active banks and the renderers' URL helpers. Scanning media folders
// would also download retired questions, source files and earlier image versions.
export function collectStartupImages(categories = CATS, pictures = fabrakaPictures, { coverSource = categoryCoverSource } = {}) {
  const urls = new Set();
  const add = (url) => {
    if (typeof url !== 'string' || !url || /^data:/i.test(url) || mediaKind(url) !== 'image') return;
    urls.add(url);
  };

  for (const category of categories) {
    add(coverSource(category.id));
    for (const question of category.qs || []) {
      const type = question.type || category.defaultType;
      if (type === 'image' || type === 'diff') {
        for (const url of questionMedia(question, category.id)) add(url);
      }
      // The legacy zoom/pic renderers use this field directly, without resolveMedia.
      if (type === 'zoom' || type === 'pic') add(question.image);
    }
  }
  for (const question of pictures) add(resolveMedia(pictureAsset(question)));
  return [...urls];
}

export const startupImageUrls = collectStartupImages();

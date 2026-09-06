import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  resolveMedia,
  questionMedia,
  deckMedia,
  mediaKind,
  isExternal,
  mediaEntries,
  collectCredits,
} from '../src/shared/media/resolve.js';
import { mediaRefs, checkMedia, copyMedia } from '../scripts/media.mjs';

test('resolveMedia: المرجع القصير يكمله مجلد الحزمة', () => {
  assert.equal(resolveMedia('pepsi.webp', 'logos'), 'media/logos/pepsi.webp');
  assert.equal(resolveMedia('/pepsi.webp', 'logos'), 'media/logos/pepsi.webp', 'الشرطة البادئة تُزال');
  assert.equal(resolveMedia('  pepsi.webp  ', 'logos'), 'media/logos/pepsi.webp');
  assert.equal(resolveMedia('media/other/x.webp', 'logos'), 'media/other/x.webp', 'مسار كامل يُترك كما هو');
  assert.equal(resolveMedia('pepsi.webp', null), null, 'بلا حزمة لا يمكن إكمال المسار');
  assert.equal(resolveMedia('', 'logos'), null);
  assert.equal(resolveMedia(null, 'logos'), null);
});

test('resolveMedia: العناوين الخارجية تمرّ كما هي', () => {
  for (const url of ['https://cdn.example.com/a.webp', 'http://x.dev/b.mp3', '//x.dev/c.mp4', 'data:image/png;base64,AAA']) {
    assert.ok(isExternal(url), url);
    assert.equal(resolveMedia(url, 'logos'), url);
  }
  assert.ok(!isExternal('pepsi.webp'));
});

test('questionMedia: ملف واحد أو عدة ملفات', () => {
  assert.deepEqual(questionMedia({ media: 'a.webp' }, 'p'), ['media/p/a.webp']);
  assert.deepEqual(questionMedia({ media: ['a.webp', 'b.webp'] }, 'p'), ['media/p/a.webp', 'media/p/b.webp']);
  assert.deepEqual(questionMedia({ q: 'بلا وسائط' }, 'p'), []);
  assert.deepEqual(questionMedia(null, 'p'), []);
});

test('questionMedia وmediaRefs: كائن الإسناد { src, … } يُعامل كالنص', () => {
  const credit = { src: 'lion.webp', type: 'image', title: 'Lion', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Lion.jpg', author: 'A', license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/' };
  assert.deepEqual(questionMedia({ media: credit }, 'animals'), ['media/animals/lion.webp']);
  assert.deepEqual(questionMedia({ media: [credit, { ...credit, src: 'tiger.webp' }] }, 'animals'), ['media/animals/lion.webp', 'media/animals/tiger.webp']);
  assert.deepEqual(mediaRefs({ media: credit }), ['lion.webp']);
  assert.deepEqual(mediaRefs({ media: [credit, 'x.mp3', { src: '' }] }), ['lion.webp', 'x.mp3']);
  assert.equal(mediaEntries({ media: credit }).length, 1);
});

test('collectCredits: بطاقة إسناد لكل ملف مرة واحدة، والنصوص المجردة تُتجاهل', () => {
  const credit = { src: 'lion.webp', type: 'image', title: 'Lion', sourceUrl: 'https://x/y', author: 'A', license: 'CC BY 4.0', licenseUrl: 'https://cc/by' };
  const cats = [
    { id: 'animals', name: 'حيوانات', qs: [{ media: credit }, { media: credit }, { media: 'plain.webp' }, { q: 'نصي' }] },
    { id: 'sound', name: 'أصوات', qs: [{ media: { ...credit, src: 'roar.mp3', type: 'audio' } }] },
  ];
  const credits = collectCredits(cats);
  assert.equal(credits.length, 2);
  assert.deepEqual(credits[0], { url: 'media/animals/lion.webp', category: 'animals', categoryName: 'حيوانات', type: 'image', title: 'Lion', sourceUrl: 'https://x/y', author: 'A', license: 'CC BY 4.0', licenseUrl: 'https://cc/by' });
  assert.equal(credits[1].type, 'audio');
  assert.deepEqual(collectCredits([]), []);
});

test('deckMedia: يجمع ملفات الجولة بلا تكرار ويتجاهل حزمة غير معروفة', () => {
  const cats = [{ id: 'a' }, { id: 'b' }];
  const deck = {
    a: [{ media: '1.webp' }, { media: '1.webp' }, { media: ['2.webp', '3.mp3'] }],
    b: [{ media: 'https://x.dev/z.mp4' }],
    ghost: [{ media: 'nope.webp' }],
  };
  assert.deepEqual(deckMedia(deck, cats), [
    'media/a/1.webp',
    'media/a/2.webp',
    'media/a/3.mp3',
    'https://x.dev/z.mp4',
  ]);
});

test('mediaKind: من الامتداد، ونوع السؤال أدقّ', () => {
  assert.equal(mediaKind('media/a/x.webp'), 'image');
  assert.equal(mediaKind('media/a/x.PNG'), 'image');
  assert.equal(mediaKind('media/a/x.mp3'), 'audio');
  assert.equal(mediaKind('media/a/x.mp4'), 'video');
  assert.equal(mediaKind('media/a/x.webm'), 'video');
  assert.equal(mediaKind('https://x.dev/s.mp3?v=2'), 'audio', 'استعلام بعد الامتداد');
  assert.equal(mediaKind('https://x.dev/stream', 'audio'), 'audio', 'نوع السؤال يحسم بلا امتداد');
  assert.equal(mediaKind('https://x.dev/stream'), 'image', 'المجهول يُعامَل كصورة');
});

test('mediaRefs: يقبل نصًا أو مصفوفة ويتجاهل الفراغ', () => {
  assert.deepEqual(mediaRefs({ media: 'a.webp' }), ['a.webp']);
  assert.deepEqual(mediaRefs({ media: ['a.webp', '', '  b.mp3 '] }), ['a.webp', 'b.mp3']);
  assert.deepEqual(mediaRefs({}), []);
});

// ── تحقق البناء ────────────────────────────────────────────────────────────
async function fixture(packs, files) {
  const root = await mkdtemp(path.join(tmpdir(), 'maydan-media-'));
  await mkdir(path.join(root, 'src/data/categories'), { recursive: true });
  for (const pack of packs) {
    await writeFile(path.join(root, 'src/data/categories', `${pack.id}.json`), JSON.stringify(pack));
  }
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, 'media', rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body);
  }
  return root;
}

test('checkMedia: حزمة سليمة بلا أخطاء، وتُحصى ملفاتها', async () => {
  const root = await fixture(
    [{ id: 'logos', name: 'شعارات', qs: [
      { qid: 'a'.repeat(12), p: 200, type: 'image', media: 'pepsi.webp' },
      { qid: 'b'.repeat(12), p: 400, type: 'audio', media: 'jingle.mp3' },
      { qid: 'c'.repeat(12), p: 600, type: 'image', media: 'https://cdn.example.com/x.webp' },
    ] }],
    { 'logos/pepsi.webp': 'IMG', 'logos/jingle.mp3': 'SND' },
  );
  const { errors, packs } = await checkMedia(root);
  assert.deepEqual(errors, []);
  assert.equal(packs.length, 1);
  assert.equal(packs[0].refs, 3);
  assert.equal(packs[0].external, 1, 'العنوان الخارجي يُعدّ ولا يُفحص على القرص');
  assert.equal(packs[0].bytes, 6);
  await rm(root, { recursive: true, force: true });
});

test('checkMedia: ملف مفقود، وامتداد مجهول، ونوع لا يطابق الملف', async () => {
  const root = await fixture(
    [{ id: 'mix', name: 'خليط', qs: [
      { qid: '1'.repeat(12), p: 200, type: 'image', media: 'missing.webp' },
      { qid: '2'.repeat(12), p: 400, type: 'image', media: 'weird.xyz' },
      { qid: '3'.repeat(12), p: 600, type: 'audio', media: 'photo.webp' },
      { qid: '4'.repeat(12), p: 800, type: 'video', media: 'song.mp3' },
    ] }],
    { 'mix/weird.xyz': 'X', 'mix/photo.webp': 'IMG', 'mix/song.mp3': 'SND' },
  );
  const { errors } = await checkMedia(root);
  const has = (needle) => errors.some((e) => e.includes(needle));
  assert.equal(errors.length, 5, errors.join(' | '));
  assert.ok(has('missing.webp') && has('غير موجود'));
  assert.ok(has('امتداد غير مدعوم'), 'الامتداد المجهول يُبلَّغ عنه');
  assert.ok(has('سؤال صورة بملف ليس صورة'), 'وامتداد مجهول لا يُعدّ صورة أيضًا');
  assert.ok(has('سؤال صوتي'));
  assert.ok(has('سؤال فيديو'));
  await rm(root, { recursive: true, force: true });
});

test('checkMedia: المسار الكامل media/ يشير إلى حزمة أخرى', async () => {
  const root = await fixture(
    [{ id: 'a', name: 'أ', qs: [{ qid: '5'.repeat(12), p: 200, type: 'image', media: 'media/shared/logo.webp' }] }],
    { 'shared/logo.webp': 'IMG' },
  );
  const { errors } = await checkMedia(root);
  assert.deepEqual(errors, []);
  await rm(root, { recursive: true, force: true });
});

test('checkMedia: بلا مجلد فئات لا ينهار', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'maydan-media-'));
  assert.deepEqual(await checkMedia(root), { errors: [], packs: [] });
  await rm(root, { recursive: true, force: true });
});

test('copyMedia: ينسخ الملفات ويستثني README', async () => {
  const root = await fixture([], { 'logos/pepsi.webp': 'IMG', 'README.md': 'دليل' });
  const dist = path.join(root, 'dist');
  const { count, total } = await copyMedia(root, dist);
  assert.equal(count, 1);
  assert.equal(total, 3);
  assert.deepEqual(await readdir(path.join(dist, 'media')), ['logos']);
  await rm(root, { recursive: true, force: true });
});

// وسائط الحزم: تُنسخ إلى الموقع، ويُتحقق من أن كل ملف يشير إليه سؤال موجود فعلًا.
// السؤال بصورة مفقودة أسوأ من غياب السؤال، فالبناء يفشل بدل أن ينشرها.
import { readFile, readdir, stat, cp, mkdir } from 'node:fs/promises';
import path from 'node:path';

const IMAGE = /\.(webp|png|jpe?g|gif|avif|svg)$/i;
const AUDIO = /\.(mp3|m4a|aac|ogg|opus|wav)$/i;
const VIDEO = /\.(mp4|webm|mov)$/i;
const EXTERNAL = /^(https?:)?\/\/|^data:/i;

// المرجع نص أو كائن إسناد { src, … }؛ هنا يهمّنا المسار فقط.
export function mediaRefs(question) {
  if (!question || question.media == null) return [];
  return (Array.isArray(question.media) ? question.media : [question.media])
    .map((r) => (r && typeof r === 'object' ? String(r.src || '') : String(r || '')).trim())
    .filter(Boolean);
}

async function exists(file) {
  try { await stat(file); return true; } catch { return false; }
}

async function dirSize(dir) {
  let total = 0;
  let count = 0;
  const walk = async (d) => {
    let entries;
    try { entries = await readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else { const s = await stat(full); total += s.size; count += 1; }
    }
  };
  await walk(dir);
  return { total, count };
}

// يفحص كل حزمة: هل ملفات أسئلتها موجودة؟ يعيد { errors, packs }.
export async function checkMedia(root) {
  const catsDir = path.join(root, 'src/data/categories');
  const mediaDir = path.join(root, 'media');
  const errors = [];
  const packs = [];
  let files;
  try { files = (await readdir(catsDir)).filter((f) => f.endsWith('.json')); } catch { return { errors, packs }; }

  for (const file of files) {
    const pack = JSON.parse(await readFile(path.join(catsDir, file), 'utf8'));
    const refs = [];
    for (const q of pack.qs || []) {
      for (const ref of mediaRefs(q)) refs.push({ ref, qid: q.qid, type: q.type });
    }
    if (!refs.length) continue;
    let bytes = 0;
    let external = 0;
    for (const { ref, qid, type } of refs) {
      if (EXTERNAL.test(ref)) { external += 1; continue; }
      const rel = ref.startsWith('media/') ? ref.slice('media/'.length) : path.join(pack.id, ref);
      const full = path.join(mediaDir, rel);
      if (!(await exists(full))) {
        errors.push(`${pack.id}/${qid}: الملف غير موجود — media/${rel}`);
        continue;
      }
      const known = IMAGE.test(ref) || AUDIO.test(ref) || VIDEO.test(ref);
      if (!known) errors.push(`${pack.id}/${qid}: امتداد غير مدعوم — ${ref}`);
      if (type === 'audio' && !AUDIO.test(ref)) errors.push(`${pack.id}/${qid}: سؤال صوتي بملف ليس صوتًا — ${ref}`);
      if (type === 'video' && !VIDEO.test(ref)) errors.push(`${pack.id}/${qid}: سؤال فيديو بملف ليس فيديو — ${ref}`);
      if (type === 'image' && !IMAGE.test(ref)) errors.push(`${pack.id}/${qid}: سؤال صورة بملف ليس صورة — ${ref}`);
      bytes += (await stat(full)).size;
    }
    packs.push({ id: pack.id, name: pack.name, refs: refs.length, external, bytes });
  }
  return { errors, packs };
}

export async function copyMedia(root, dist) {
  const from = path.join(root, 'media');
  if (!(await exists(from))) return { count: 0, total: 0 };
  const to = path.join(dist, 'media');
  await mkdir(to, { recursive: true });
  await cp(from, to, { recursive: true, filter: (src) => !src.endsWith('README.md') });
  return dirSize(to);
}

export const fmtMB = (n) => (n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

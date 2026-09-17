// Wait for real visual work, with a failure deadline (never a minimum delay).
// Decode/cache identity assets only; question videos/audio load when requested.
const imageTasks = new Map();

export function settleWithin(task, milliseconds = 5000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), milliseconds);
    Promise.resolve(task).then(() => { clearTimeout(timer); resolve(true); }, () => { clearTimeout(timer); resolve(false); });
  });
}

export function prepareImage(source) {
  if (!source || typeof Image === 'undefined') return Promise.resolve(true);
  if (imageTasks.has(source)) return imageTasks.get(source);
  const task = settleWithin(new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if (typeof img.decode === 'function') Promise.resolve().then(() => img.decode()).then(resolve, reject);
      else resolve();
    };
    img.onerror = reject;
    img.src = source;
  }));
  imageTasks.set(source, task);
  void task.then((ok) => { if (!ok) imageTasks.delete(source); });
  return task;
}

export async function prepareVisuals({ images = [], fonts = true, onProgress = () => {} } = {}) {
  const tasks = images.map(prepareImage);
  if (fonts && typeof document !== 'undefined' && document.fonts?.load) {
    tasks.push(settleWithin(Promise.resolve().then(() => Promise.all([
      document.fonts.load('700 24px "Maydan Round"', 'ميدان'),
      document.fonts.load('700 24px "Maydan Round"', 'Maydan'),
    ]))));
  }
  let complete = 0;
  const total = tasks.length;
  onProgress({ complete, total });
  const results = await Promise.all(tasks.map(async (task) => {
    const ok = await task;
    complete += 1;
    onProgress({ complete, total });
    return ok;
  }));
  return { ready: true, degraded: results.some((ok) => !ok) };
}

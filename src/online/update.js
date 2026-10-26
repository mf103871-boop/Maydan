// تحميل أحدث نسخة قبل إعادة فتح الغرفة. العامل الخدمي يجيب التنقل من مخزنه أولًا، فإعادة
// تحميل مجردة كانت تعيد النسخة القديمة نفسها مرة أولى. نطلب فحص العامل: نسخة جديدة منه
// تخزّن المستند الجديد عند تثبيتها وتتولى الصفحة (controllerchange)، ثم نعيد التحميل.
// المقعد محفوظ في التخزين المحلي، و#/room/<الرمز> يستأنفه تلقائيًا.
export async function reloadWithLatestVersion({ timeout = 8000, environment = globalThis } = {}) {
  try {
    const workers = environment.navigator?.serviceWorker;
    const registration = workers && await workers.getRegistration();
    if (registration) {
      const takenOver = new Promise((resolve) => {
        workers.addEventListener('controllerchange', resolve, { once: true });
        setTimeout(resolve, timeout);
      });
      await registration.update();
      if (registration.installing || registration.waiting) await takenOver;
    }
  } catch { /* the reload below still fetches what the network has */ }
  environment.location.reload();
}

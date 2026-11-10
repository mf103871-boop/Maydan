// This file is served only by the loopback Node harness and is not bundled.
(() => {
  'use strict';
  const prefix = `maydan:environment:${encodeURIComponent(location.origin)}:account:`;
  const post = async (route, data, token) => {
    const response = await fetch('/__rewarded_lab__/' + route, { method: 'POST', cache: 'no-store',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
      body: JSON.stringify(data) });
    if (!response.ok) throw new Error('تعذّر تنفيذ طلب المختبر');
    return response.json();
  };
  const panel = document.createElement('details');
  panel.dir = 'rtl';
  panel.style.cssText = 'position:fixed;left:10px;top:max(8px,env(safe-area-inset-top));z-index:1001;max-width:min(295px,92vw);background:#20182a;color:#fff8eb;border:1px solid #af8fc4;border-radius:12px;padding:5px 10px;font:15px system-ui;';
  panel.innerHTML = '<summary style="min-height:44px;display:flex;align-items:center;cursor:pointer">مختبر الإعلانات · محلي</summary><div style="display:grid;gap:8px;padding-bottom:10px"><label>الحساب <select aria-label="الحساب التجريبي"><option value="guest">ضيف</option><option value="A">A · بدون إعلانات</option><option value="B">B · زر إعلان بعد التجربة</option><option value="plus">بلس · اشتراك تجريبي</option></select></label><label>نتيجة المحاكاة <select aria-label="نتيجة المحاكاة"><option value="complete">اكتمال</option><option value="delay">تأخير التأكيد</option><option value="empty">إعلان غير متاح</option><option value="skip">تخطٍ</option></select></label><label><input type="checkbox" checked> عرض الإعلانات</label><a style="color:#fbd0ff" href="/#/game/badeeha?mode=local">بديهة</a><a style="color:#fbd0ff" href="/#/online/meenfina">مين فينا</a><a style="color:#fbd0ff" href="/__rewarded_lab__/metrics" target="_blank" rel="noopener">عدادات المحاكاة</a><small role="status"></small></div>';
  document.body.append(panel);
  const account = panel.querySelector('select'), mode = panel.querySelectorAll('select')[1];
  const ads = panel.querySelector('input'), note = panel.querySelector('small');
  account.value = sessionStorage.getItem('rewarded-lab-actor') || 'guest';
  mode.value = sessionStorage.getItem('rewarded-lab-mode') || 'complete';
  ads.checked = sessionStorage.getItem('rewarded-lab-ads') !== 'off';
  mode.onchange = () => { sessionStorage.setItem('rewarded-lab-mode', mode.value); panel.open = false; };
  account.onchange = async () => {
    try {
      account.disabled = true;
      if (account.value === 'guest') {
        localStorage.removeItem(prefix + 'session'); localStorage.removeItem(prefix + 'me');
      } else {
        const actor = await post('actor', { group: account.value });
        localStorage.setItem(prefix + 'session', JSON.stringify(actor.token));
        localStorage.setItem(prefix + 'me', JSON.stringify({ data: actor.me, fetchedAt: Date.now() }));
      }
      sessionStorage.setItem('rewarded-lab-actor', account.value);
      location.reload();
    } catch (error) { note.textContent = error.message; account.disabled = false; }
  };
  ads.onchange = async () => {
    try {
      await post('ads', { enabled: ads.checked });
      sessionStorage.setItem('rewarded-lab-ads', ads.checked ? 'on' : 'off');
      location.reload();
    } catch (error) { note.textContent = error.message; }
  };
  window.maydanRewardedMetric = data => { void post('metric', data).catch(() => {}); };
  window.maydanRewardedLab = async attemptId => {
    panel.open = false;
    const outcome = mode.value;
    if (outcome === 'empty') return { state: 'unavailable', presented: false };
    const token = JSON.parse(localStorage.getItem(prefix + 'session') || 'null');
    const marker = document.querySelector('[data-maydan-rewarded-active]');
    if (!token || !marker) return { state: 'blocked', presented: false };
    const scope = marker.closest('[aria-label="تحدّي اللمّة التجريبي"]');
    const offer = scope?.textContent.includes('بديهة') ? 'badeeha-demo' : 'meenfina-demo';
    const dialog = document.createElement('dialog');
    dialog.dir = 'rtl';
    dialog.setAttribute('aria-label', 'إعلان اختباري');
    dialog.style.cssText = 'max-width:min(88vw,380px);border:1px solid #af8fc4;border-radius:16px;background:#fff8eb;color:#20182a;padding:20px;box-shadow:0 16px 70px #19102090;font:16px system-ui';
    dialog.innerHTML = '<h2>إعلان اختباري محلي</h2><p>تحاكي هذه الشاشة مشاهدة إعلان ثم تأكيد تذكرة مباراة واحدة.</p><form method="dialog" style="display:flex;flex-wrap:wrap;gap:8px"><button class="btn" value="skip">تخطّي</button><button class="btn accent" value="complete" style="min-height:44px">إكمال المشاهدة التجريبية</button></form>';
    if (outcome === 'skip') dialog.querySelector('[value=complete]').hidden = true;
    document.body.append(dialog);
    const close = new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true }));
    dialog.showModal();
    window.maydanRewardedMetric({ offer, event: 'impression' });
    const result = await close;
    dialog.remove();
    if (result !== 'complete' || !marker.isConnected || JSON.parse(localStorage.getItem(prefix + 'session') || 'null') !== token) {
      return { state: 'skipped', presented: true };
    }
    const verify = () => post('complete', { attemptId }, token);
    if (outcome === 'delay') setTimeout(() => { void verify().catch(() => {}); }, 4200);
    else await verify();
    return { state: 'pending', presented: true };
  };
})();

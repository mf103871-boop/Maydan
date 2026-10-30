import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';

test('Mafia connection status keeps readable state palettes at phone, keyboard and landscape sizes', { timeout: 30000 }, async () => {
  const css = (await Promise.all(['src/online/online.css', 'src/online/online-mafia.css'].map(file => readFile(file, 'utf8')))).join('\n');
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch({ headless: true });
    try {
      const page = await browser.newPage({ reducedMotion: 'reduce' });
      for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 390, height: 490 }, { width: 844, height: 390 }]) {
        await page.setViewportSize(viewport);
        for (const status of ['connected', 'reconnecting', 'disconnected']) {
          await page.setContent(`<html lang="ar" dir="rtl"><style>${css}</style><div class="mafia-room-shell"><header class="mafia-room-tools"><span role="status" class="online-connection ${status === 'connected' ? 'connected' : ''}">${status === 'connected' ? 'متصل' : status === 'reconnecting' ? 'يعاد الاتصال' : 'انتهى الاتصال'}</span></header></div></html>`);
          const values = await page.getByRole('status').evaluate(node => {
            const s = getComputedStyle(node);
            const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
            const a = luminance(s.color), b = luminance(s.backgroundColor);
            return { contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), color: s.color, background: s.backgroundColor, fontSize: s.fontSize };
          });
          assert.ok(values.contrast >= 4.5, `${status} at ${viewport.width}×${viewport.height}: ${JSON.stringify(values)}`);
          assert.equal(values.fontSize, '11px', 'contrast repair must preserve the compact status layout');
          assert.equal(values.color, status === 'connected' ? 'rgb(158, 215, 194)' : 'rgb(180, 197, 214)', 'retain the state-specific foreground identity');
        }
      }
    } finally { await browser.close(); }
  }
});

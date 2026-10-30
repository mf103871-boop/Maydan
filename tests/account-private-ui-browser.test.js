import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

test('Chromium/WebKit: account deletion confirmations and gift drafts cannot cross owners or dialog instances', { timeout: 30000 }, async () => {
  const built = await build({ stdin: { contents: `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{AccountContext,NULL_ACCOUNT}from'./src/shared/account/context.js';import{AccountCard}from'./src/shared/account/AccountCard.jsx';import tokens from'./src/shared/theme/tokens.css';import css from'./src/shared/ui/ui.css';
    const refresh=async()=>{};window.deleted=[];window.redemptions=[];
    function App(){const[id,setId]=useState('A');window.switchOwner=setId;const account={...NULL_ACCOUNT,ready:true,signedIn:true,user:{id,name:'user-'+id},platform:'web',refresh,deleteAccount:async()=>{window.deleted.push(id)},redeem:code=>new Promise(resolve=>window.redemptions.push({id,code,resolve}))};return <AccountContext.Provider value={account}><style>{tokens+css}</style><AccountCard/></AccountContext.Provider>}
    createRoot(document.getElementById('root')).render(<App/>);`, loader: 'jsx', resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.js': 'jsx', '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl' }, logLevel: 'silent' });
  const server = createServer((request, response) => { response.setHeader('content-type', request.url === '/bundle.js' ? 'text/javascript' : 'text/html'); response.end(request.url === '/bundle.js' ? built.outputFiles[0].contents : '<!doctype html><meta charset="utf-8"><div id="root"></div><script src="/bundle.js"></script>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const engine of [chromium, webkit]) {
      const browser = await engine.launch({ headless: true });
      try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        await page.locator('[data-design-id="account-delete"]').click();
        await page.getByRole('dialog', { name: 'حذف الحساب؟', exact: true }).waitFor();
        await page.evaluate(() => window.switchOwner('B'));
        await page.getByText('user-B', { exact: true }).waitFor();
        assert.equal(await page.getByRole('dialog').count(), 0, 'A confirmation is removed before it can bind to B');
        assert.deepEqual(await page.evaluate(() => window.deleted), []);
        await page.locator('[data-design-id="account-delete"]').click();
        await page.getByRole('button', { name: 'نعم، احذف الحساب', exact: true }).click();
        assert.deepEqual(await page.evaluate(() => window.deleted), ['B'], 'a fresh confirmation still performs its own action');

        await page.getByRole('button', { name: 'لديك رمز هدية؟', exact: true }).click();
        await page.getByRole('textbox', { name: 'رمز الهدية', exact: true }).fill('PRIVATE-B-CODE');
        await page.evaluate(() => window.switchOwner('C'));
        await page.getByText('user-C', { exact: true }).waitFor();
        assert.equal(await page.getByRole('dialog').count(), 0);
        await page.getByRole('button', { name: 'لديك رمز هدية؟', exact: true }).click();
        assert.equal(await page.getByRole('textbox', { name: 'رمز الهدية', exact: true }).inputValue(), '');
        await page.getByRole('textbox', { name: 'رمز الهدية', exact: true }).fill('C-FIRST');
        await page.getByRole('button', { name: 'تفعيل', exact: true }).click();
        await page.waitForFunction(() => window.redemptions.length === 1);
        await page.getByRole('dialog').getByRole('button', { name: 'إغلاق', exact: true }).click();
        await page.getByRole('dialog').waitFor({ state: 'detached' });
        await page.getByRole('button', { name: 'لديك رمز هدية؟', exact: true }).click();
        await page.getByRole('textbox', { name: 'رمز الهدية', exact: true }).fill('C-NEW-DRAFT');
        await page.evaluate(async () => { window.redemptions[0].resolve(true); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
        assert.equal(await page.getByRole('dialog').count(), 1, 'completion from the dismissed instance must not close the new sheet');
        assert.equal(await page.getByRole('textbox', { name: 'رمز الهدية', exact: true }).inputValue(), 'C-NEW-DRAFT');
      } finally { await browser.close(); }
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { termsIdentity } from '../src/shared/legal/terms.js';

let compiled;
const fixture = () => compiled ||= build({ stdin: { contents: `
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import TermsConsent from './src/shared/legal/TermsConsent.jsx';import TermsDocument from './src/shared/legal/TermsDocument.jsx';
window.fixture={accepts:[],backs:0,reads:0,privacy:0,fail:false};
function App(){const[locale,setLocale]=useState(new URL(location.href).searchParams.get('lang')||'ar');const[doc,setDoc]=useState(false);
window.fixture.locale=setLocale;window.fixture.document=()=>setDoc(true);window.fixture.consent=()=>setDoc(false);
return doc?<TermsDocument locale={locale}/>:<TermsConsent locale={locale} onBack={()=>window.fixture.backs++} onReadPrivacy={()=>window.fixture.privacy++} onReadTerms={()=>window.fixture.reads++}
onAccept={async value=>{window.fixture.accepts.push(value);if(window.fixture.fail)throw Error('fixture rejection');await new Promise(resolve=>{window.fixture.resolve=resolve});}}/>}
createRoot(document.getElementById('root')).render(<App/>);`, loader: 'jsx', resolveDir: process.cwd() }, bundle:true, write:false, format:'iife', jsx:'automatic', loader:{'.css':'text'}, logLevel:'silent' });

for(const [name,engine] of [['chromium',chromium],['webkit',webkit]])for(const locale of ['ar','en'])test(`${name}: ${locale} explicit terms consent, no-scroll requirement, reset, failure and readable narrow document`,{timeout:60000},async()=>{
 const result=await fixture(),browser=await engine.launch({headless:true}),page=await browser.newPage({viewport:{width:320,height:640}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:8px;background:#fff8eb;font-family:Arial}*{box-sizing:border-box}</style><div id="root"></div><script>${result.outputFiles[0].text}</script>`}));
  await page.goto('https://terms.example.test/?lang='+locale);
  const box=page.getByRole('checkbox'),accept=page.locator('button[type="submit"]');await box.waitFor();
  if(process.env.MAYDAN_TERMS_SCREENSHOTS){await mkdir(process.env.MAYDAN_TERMS_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.MAYDAN_TERMS_SCREENSHOTS,`terms-${name}-${locale}-320.png`),fullPage:true});}
  assert.equal(await box.isChecked(),false);assert.equal(await accept.isDisabled(),true);
  await page.locator('.terms-read-actions button').first().click();await page.locator('.terms-read-actions button').last().click();await page.locator('.terms-secondary').click();
  assert.deepEqual(await page.evaluate(()=>({accepts:window.fixture.accepts.length,backs:window.fixture.backs,reads:window.fixture.reads,privacy:window.fixture.privacy})),{accepts:0,backs:1,reads:1,privacy:1});
  assert.equal(await box.isChecked(),false);
  await box.focus();await page.keyboard.press('Space');assert.equal(await accept.isEnabled(),true,'only checkbox is needed; document scroll is not a condition');
  await accept.click();await page.waitForFunction(()=>window.fixture.accepts.length===1);assert.equal(await accept.isDisabled(),true);assert.equal(await box.isDisabled(),true);
  // A duplicate submit dispatched while the first promise waits is also blocked.
  await page.locator('form').dispatchEvent('submit');assert.equal(await page.evaluate(()=>window.fixture.accepts.length),1);
  assert.deepEqual(await page.evaluate(()=>window.fixture.accepts[0]),{...termsIdentity(locale),accepted:true});
  await page.evaluate(()=>window.fixture.resolve());await page.waitForFunction(()=>!document.querySelector('button[type=submit]').disabled);
  const next=locale==='ar'?'en':'ar';await page.evaluate(value=>window.fixture.locale(value),next);await page.waitForFunction(value=>document.querySelector('.terms-consent').lang===value,next);
  assert.equal(await box.isChecked(),false);assert.equal(await accept.isDisabled(),true);
  await page.evaluate(()=>window.fixture.fail=true);await box.check();await accept.click();await page.getByRole('alert').waitFor();assert.equal(await accept.isEnabled(),true);
  const geometry=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,buttons:[...document.querySelectorAll('button,.terms-check')].map(el=>({height:el.getBoundingClientRect().height,width:el.getBoundingClientRect().width})),direction:getComputedStyle(document.querySelector('.terms-consent')).direction}));
  assert.equal(geometry.overflow,false);assert.ok(geometry.buttons.every(rect=>rect.height>=48&&rect.width>=48));assert.equal(geometry.direction,next==='ar'?'rtl':'ltr');
  await page.evaluate(()=>window.fixture.document());await page.locator('.terms-document h1').waitFor();assert.equal(await page.locator('.terms-document section').count(),9);
  await page.locator('.terms-document a').scrollIntoViewIfNeeded();const support=await page.locator('.terms-document a').boundingBox();assert.ok(support.height>=48);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});

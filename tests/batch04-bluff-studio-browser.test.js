import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { presentationCssPlugin } from '../scripts/presentation-css.mjs';

const source = String.raw`
import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrandFonts } from './src/shared/brand/art.jsx';
import { setUiLocale, untranslatedUiKeys } from './src/shared/i18n/core.js';
import { Game as Fabraka, SetupOptions as FabSetup } from './src/games/fabraka/Game.jsx';
import { Game as Meen, SetupOptions as MeenSetup } from './src/games/meenfina/Game.jsx';
import * as fab from './src/games/fabraka/logic.js';
import * as meen from './src/games/meenfina/logic.js';
import { FabrakaMatch } from './src/online/Fabraka.jsx';
import { Match, RoomChrome } from './src/online/Online.jsx';
import { GameFrame } from './src/platform/GameFrame.jsx';
import { PlatformContext } from './src/platform/context.js';
import { PlayersSetup } from './src/shared/setup/PlayersSetup.jsx';
import { Screen } from './src/shared/ui/components.jsx';
import * as server from './server/game-model.mjs';
import fabMeta from './src/games/fabraka/meta.js';
import meenMeta from './src/games/meenfina/meta.js';
import fabQuestionsAr from './src/data/games/fabraka/questions.json';
import fabQuestionsEn from './src/data/locales/en/games/fabraka/questions.json';
import pictureQuestionsAr from './src/data/games/fabraka/pictures.json';
import pictureQuestionsEn from './src/data/locales/en/games/fabraka/pictures.json';
import friendsQuestionsAr from './src/data/games/fabraka/personal.json';
import friendsQuestionsEn from './src/data/locales/en/games/fabraka/personal.json';
import statementsAr from './src/data/games/meenfina/statements.json';
import statementsEn from './src/data/locales/en/games/meenfina/statements.json';
import tokens from './src/shared/theme/tokens.css';
import ui from './src/shared/ui/ui.css';
import brand from './src/shared/brand/brand.css';
import setup from './src/shared/setup/setup.css';
import platformCss from './src/platform/platform.css';
import playful from './src/platform/playful-studio.css';
import online from './src/online/online.css';

const locale = new URLSearchParams(location.search).get('locale') === 'en' ? 'en' : 'ar';
const isEnglish = locale === 'en';
const now = Date.now();
await setUiLocale(locale);
const noop = () => {};
const people = ['😎','🦋','🌟','🚀'].map((emoji, index) => ({
  id: String(index + 1).repeat(32), tokenHash: String(index + 1).repeat(64),
  name: (isEnglish ? ['Mohammad','Noura','Sara','Yazan'] : ['محمد','نورة','سارة','يزن'])[index],
  color: ['#08796d','#9953a9','#cc785c','#b07c20'][index], avatar: index, emoji,
}));
const fabQuestions = isEnglish ? fabQuestionsEn : fabQuestionsAr;
const beaver = fabQuestions.find(question => question.sourceUrl?.includes('nationalzoo.si.edu/animals/beaver'));
const pictures = isEnglish ? pictureQuestionsEn : pictureQuestionsAr;
const friends = isEnglish ? friendsQuestionsEn : friendsQuestionsAr;
const statements = isEnglish ? statementsEn : statementsAr;
const beaverDeck = [beaver, ...fabQuestions.filter(question => question !== beaver)].slice(0, 14);
const replies = isEnglish ? ['Copper','Sulphur','Gold','Silver'] : ['النحاس','الكبريت','الذهب','الفضة'];
const fabAct = (state, type, values = {}) => fab.reduce(state, { type, round: state.round, key: fab.turnKey(state), playerId: fab.currentActor(state)?.id, ...values });
const newFab = (options, deck) => fab.initialState(people, {rounds:3,writeSeconds:45,discussionSeconds:20,contentLocale:locale,...options},{deck,seed:42,sessionId:'bluff-studio'});
function fabFixtures() {
  const intro = newFab({}, beaverDeck);
  const question = fabAct(intro, 'BEGIN');
  const handoff = fabAct(question, 'START_WRITING');
  const write = fabAct(handoff, 'READY');
  let discussion = handoff;
  let index = 0;
  while (discussion.phase === 'write') {
    discussion = fabAct(discussion, 'READY');
    discussion = fabAct(discussion, 'DRAFT', {text:replies[index++]});
    discussion = fabAct(discussion, 'SUBMIT_LIE');
  }
  let vote = fabAct(discussion, 'START_VOTE');
  const voteGate = vote;
  const voteShown = fabAct(vote, 'READY');
  while (vote.phase === 'vote') {
    vote = fabAct(vote, 'READY');
    const voter = fab.currentActor(vote).id;
    const funny = vote.options.find(option => option.text === replies[0] && !option.owners.includes(voter));
    vote = fabAct(vote, 'VOTE', {optionId:funny?.id ?? fab.TRUTH_ID, funnyId:funny?.id || null});
  }
  let reveal = fabAct(vote, 'START_REVEAL');
  const concealedReveal = reveal;
  while (reveal.revealIndex < reveal.revealGroups.length - 1) {
    reveal = fabAct(fabAct(reveal, 'REVEAL'), 'REVEAL_NEXT');
  }
  reveal = fabAct(reveal, 'REVEAL');
  const roundEnd = fabAct(reveal, 'REVEAL_NEXT');
  let over = roundEnd;
  while (over.phase !== 'over') {
    over = fabAct(over, 'NEXT_ROUND');
    if (over.phase === 'over') break;
    over = fabAct(fabAct(over, 'BEGIN'), 'START_WRITING');
    while (over.phase === 'write') over = fabAct(fabAct(over, 'READY'), 'SKIP_WRITE');
    over = fabAct(over, 'START_VOTE');
    while (over.phase === 'vote') over = fabAct(fabAct(over, 'READY'), 'VOTE', {optionId:fab.TRUTH_ID});
    over = fabAct(over, 'START_REVEAL');
    while (over.phase === 'reveal') over = fabAct(fabAct(over, 'REVEAL'), 'REVEAL_NEXT');
  }
  const host = fabAct(newFab({mode:'friends'}, friends), 'BEGIN');
  const picture = fabAct(newFab({mode:'pictures'}, pictures), 'BEGIN');
  return {handoff,write,discussion,voteGate,voteShown,concealedReveal,reveal,roundEnd,over,host,picture};
}

function meenFixtures() {
  const point = meen.initialState(people, {mode:'point',rounds:5});
  const countdown = meen.reduce(point, {type:'BEGIN', statement:statements[0]});
  const pick = meen.reduce(countdown, {type:'COUNTDOWN_DONE'});
  const intro = meen.initialState(people, {mode:'secret',rounds:5});
  const secret = meen.reduce(intro, {type:'BEGIN', statement:statements[0]});
  return {countdown,pick,secret};
}

function onlineRoom(game) {
  const settings = game === 'fabraka' ? {mode:'classic',rounds:3,writeSeconds:45,discussionSeconds:20} : {rounds:5};
  const room = server.createRoom('482761', {...people[0],game,settings,rounds:5}, now);
  const deck = game === 'fabraka' ? beaverDeck : statements.slice(0,5);
  const act = (index,type,fields={}) => server.action(room, people[index].id, {type,matchId:room.matchId,round:room.round,...fields}, now, deck);
  people.slice(1).forEach(person => server.joinRoom(room, person, now));
  people.forEach((person,index) => { server.connected(room,person.id,true,now); act(index,'ready',{ready:true}); });
  act(0,'start');
  return {room,act};
}

const fabStates = fabFixtures();
const meenStates = meenFixtures();
const traces = [];
const settings = {soundOn:true,reducedMotion:true};
const sound = {play:noop,emit:noop,music:{scene:noop,releaseScene:noop}};
const haptics = {vibrate:noop};
const context = {settings,setSettings:noop,sound,haptics,toast:noop};
const styles = tokens + ui + brand + setup + platformCss + playful + online;

function Harness() {
  const [scene,setScene] = useState({id:'fab-setup',key:0});
  const [run,setRun] = useState(null);
  const [revision,setRevision] = useState(0);
  const [inGame,setInGame] = useState(false);
  window.openScene = id => {
    setInGame(false);
    if (id.startsWith('online')) {
      const selectedGame = id.startsWith('online-fab') ? 'fabraka' : 'meenfina';
      const fresh = onlineRoom(selectedGame);
      if (selectedGame === 'fabraka') fresh.act(1,'lie',{text:replies[1]});
      setRun(fresh);
    }
    setScene(previous => ({id,key:previous.key+1}));
  };
  window.reply = (seat,type,fields={}) => { run.act(seat,type,fields); setRevision(value=>value+1); };
  window.projection = () => run ? server.snapshot(run.room,people[0].id,now) : null;
  window.traces = traces;
  window.missing = untranslatedUiKeys;
  const game = scene.id.startsWith('fab') ? fabMeta : meenMeta;
  const memory = useMemo(() => new Map(), [scene.key]);
  const api = useMemo(() => ({
    storage:{get:(key,fallback)=>memory.get(key)??fallback,set:(key,value)=>(memory.set(key,value),true),remove:key=>memory.delete(key),persistent:true},
    sound,haptics,confetti:{fire:noop},matchOver:value=>traces.push(value),setInGame,
    setBeforeExit:noop,setExitMessage:noop,restart:noop,backToSetup:noop,contentLocale:locale,contentVersion:isEnglish?'new-en':'legacy-ar',
  }), [memory]);
  let content;
  if (scene.id.startsWith('online') && run) {
    const viewer = scene.id.endsWith('-guest') ? 1 : 0;
    const state = server.snapshot(run.room,people[viewer].id,now);
    const View = run.room.game === 'fabraka' ? FabrakaMatch : Match;
    const act = (type,fields) => { run.act(viewer,type,fields);setRevision(value=>value+1);return Promise.resolve(true); };
    content = <Screen className="stack online-screen" data-rev={revision}>
      <RoomChrome state={state} code={state.code} status="connected" onExit={noop}>
        <View state={state} me={state.members[viewer]} disabled={false} isHost={viewer===0} act={act} clockOffset={now-Date.now()} />
      </RoomChrome>
    </Screen>;
  } else {
    const Views = game.id === 'fabraka' ? {Game:Fabraka,Options:FabSetup,fixtures:fabStates} : {Game:Meen,Options:MeenSetup,fixtures:meenStates};
    const phase = scene.id.slice(scene.id.indexOf('-')+1);
    const state = Views.fixtures[phase];
    content = <GameFrame game={game} inGame={inGame} onExit={noop}>
      {phase === 'setup' ? <>
        <Screen><PlayersSetup roster={people} setRoster={noop} min={3} max={game.players.max} api={api} onStart={noop}>
          <Views.Options storage={api.storage} api={api} />
        </PlayersSetup></Screen>
      </> : <Views.Game key={scene.key} api={api} players={people} onExit={noop} designPreviewState={state} />}
    </GameFrame>;
  }
  return <PlatformContext.Provider value={context}><BrandFonts/><style>{styles}</style><main data-scene={scene.id}>{content}</main></PlatformContext.Provider>;
}

document.documentElement.dataset.reducedMotion='true';
createRoot(document.getElementById('root')).render(<Harness/>);
`;

const out = process.env.BATCH04_BLUFF_EVIDENCE_DIR;
const sha = buffer => createHash('sha256').update(buffer).digest('hex');
const sourceFiles = [
  'src/games/fabraka/Game.jsx', 'src/games/fabraka/Studio.jsx', 'src/games/fabraka/fabraka.css',
  'src/games/meenfina/Game.jsx', 'src/games/meenfina/Studio.jsx', 'src/games/meenfina/meenfina.css',
  'src/games/meenfina/choice-studio.css', 'src/online/Fabraka.jsx', 'src/online/Online.jsx',
  'src/platform/GameFrame.jsx', 'src/shared/i18n/en-games.js',
];
const sourceSHA256 = Object.fromEntries(await Promise.all(sourceFiles.map(async filename => [filename, sha(await readFile(filename))])));

for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  for (const locale of ['ar', 'en']) {
    test(`${engineName} ${locale}: Fabraka and Meen Fina studio layouts and live game actions`, { timeout: 120_000 }, async (t) => {
      const bundle = await build({
        stdin: { contents: source, resolveDir: process.cwd(), loader: 'jsx' },
        bundle: true, write: false, format: 'esm', jsx: 'automatic', logLevel: 'silent',
        plugins: [presentationCssPlugin()],
        loader: { '.js': 'jsx', '.css': 'text', '.webp': 'dataurl', '.png': 'dataurl', '.woff2': 'dataurl' },
        define: { 'process.env.NODE_ENV': '"production"', __MAYDAN_ROOMS_URL__: '"same-origin"' },
      });
      const files = path.resolve('public/media/fabraka-v3');
      const server = createServer(async (request,response) => {
        const url = new URL(request.url, 'http://localhost');
        if (url.pathname === '/bundle.js') { response.setHeader('content-type','text/javascript');response.end(bundle.outputFiles[0].contents);return; }
        const picture = /^\/media\/fabraka-v3\/(fab3-\d{3}\.webp)$/.exec(url.pathname);
        if (picture) {
          try { const asset=await readFile(path.join(files,picture[1]));response.setHeader('content-type','image/webp');response.end(asset); }
          catch { response.statusCode=404;response.end(); }
          return;
        }
        response.setHeader('content-type','text/html;charset=utf-8');
        response.end('<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/bundle.js"></script></html>');
      });
      await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
      t.after(() => new Promise(resolve => { server.closeAllConnections();server.close(resolve); }));
      const home = `http://127.0.0.1:${server.address().port}`;
      const browser = await engine.launch();
      t.after(() => browser.close());
      const page = await browser.newPage({ viewport:{width:390,height:844}, reducedMotion:'reduce' });
      const errors = [], cases = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => route.request().url().startsWith(home) ? route.continue() : route.abort());
      await page.goto(`${home}/?locale=${locale}`);
      await page.locator('[data-scene=fab-setup]').waitFor();
      const open = async id => {
        await page.evaluate(id => window.openScene(id),id);
        await page.locator(`[data-scene="${id}"]`).waitFor();
        await page.evaluate(() => window.scrollTo(0,0));
      };
      const design = id => page.locator(`[data-design-id="${id}"]`);
      const checkCompactNames = async selector => {
        await page.evaluate(() => document.fonts.ready);
        const names = await page.locator(selector).evaluateAll(elements => elements.map(element => {
          const range = document.createRange();
          range.selectNodeContents(element);
          const boxes = [...range.getClientRects()];
          const bounds = element.getBoundingClientRect();
          return { name: element.textContent, width: bounds.width, textWidth: boxes[0]?.width, font: getComputedStyle(element).fontSize,
            fullyVisible: boxes.length === 1 && boxes[0].left >= bounds.left - 1 && boxes[0].right <= bounds.right + 1 };
        }));
        assert.ok(names.length && names.every(name => name.fullyVisible), JSON.stringify(names));
      };
      const record = async (name, fullPage = true) => {
        await page.evaluate(async () => {
          await document.fonts.ready;
          await Promise.all(Array.from(document.images, img => img.decode().catch(()=>{})));
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        });
        const layout = await page.evaluate(() => ({
          width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
          controls: Array.from(document.querySelectorAll('main button:not([disabled]),main summary,main input:not([disabled]),main select:not([disabled])'))
            .filter(node => !node.closest('.fab-toggle') && node.getBoundingClientRect().width>0 && node.getBoundingClientRect().height>0)
            .map(node => ({id:node.dataset.designId, text:node.textContent, height:node.getBoundingClientRect().height,width:node.getBoundingClientRect().width})),
        }));
        const title = page.locator('.game-bar .title');
        if (await title.count()) {
          const inside = await title.evaluate(element => {
            const bounds = element.getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(element);
            return [...range.getClientRects()].every(box => box.left >= bounds.left - 1 && box.right <= bounds.right + 1);
          });
          assert.ok(inside, `${name}: full local header title inside its column`);
        }
        assert.ok(layout.scrollWidth <= layout.width + 1,`${name}: horizontal overflow ${layout.scrollWidth} at ${layout.width}`);
        for (const control of layout.controls) {
          assert.ok(control.height >= 47.9 && (control.width >= 47.9 || !control.id), `${name}: ${control.id || control.text} has touch box ${control.width}×${control.height}`);
        }
        const evidence = {name,...layout};
        if (out) {
          const folder=path.resolve(out);
          await mkdir(folder,{recursive:true});
          const file=`${engineName}-${locale}-${name}.png`;
          const image=await page.screenshot({path:path.join(folder,file),fullPage,animations:'disabled'});
          Object.assign(evidence,{file,sha256:sha(image)});
        }
        cases.push(evidence);
      };
      await checkCompactNames('.players-setup-name');
      await record('fab-setup');
      const topics = page.locator('.fab-setup-modes details');
      const topicsSummary = topics.locator('summary');
      for (const width of [430, 390]) {
        await page.setViewportSize({ width, height: 844 });
        await page.evaluate(() => window.scrollTo(0, 0));
        await record(`fab-topics-first-fold-${width}`, false);
        const firstFold = await topicsSummary.evaluate(summary => {
          const start = document.querySelector('.setup-sticky [data-design-id="start"]');
          const bounds = summary.getBoundingClientRect();
          const startBounds = start.getBoundingClientRect();
          const x = (bounds.left + bounds.right) / 2;
          const y = (bounds.top + bounds.bottom) / 2;
          return {
            scrollY, viewportHeight: innerHeight, x, y,
            topicTop: bounds.top, topicBottom: bounds.bottom,
            availabilityBottom: summary.querySelector('.fab-topic-count')?.getBoundingClientRect().bottom,
            startTop: startBounds.top, startBottom: startBounds.bottom,
            topicsHit: summary.contains(document.elementFromPoint(x, y)),
            startHit: start.contains(document.elementFromPoint((startBounds.left + startBounds.right) / 2, (startBounds.top + startBounds.bottom) / 2)),
          };
        });
        Object.assign(cases.at(-1), { firstFold });
        assert.ok(firstFold.scrollY === 0 && firstFold.topicTop >= 0 && firstFold.topicBottom <= firstFold.startTop
          && firstFold.availabilityBottom <= firstFold.startTop
          && firstFold.startBottom <= firstFold.viewportHeight && firstFold.topicsHit && firstFold.startHit,
        `Topics and Start are separate, visible and both receive hits before scrolling at ${width}px: ${JSON.stringify(firstFold)}`);
        await page.mouse.click(firstFold.x, firstFold.y);
        await page.waitForFunction(() => document.querySelector('.fab-setup-modes details').open);
        if (width === 430) await topicsSummary.click();
      }
      const topic = topics.locator('[data-design-id="category-card"]:enabled').nth(1);
      await topic.evaluate(element => element.scrollIntoView({ block: 'center' }));
      await topic.click();
      assert.equal(await topic.getAttribute('aria-pressed'), 'true');
      await record('fab-topics-open', false);
      await topics.locator('[data-design-id="category-card"]').first().click();
      await topics.locator('summary').click();
      await page.locator('.fab-pacing summary').click();
      const pacing = page.locator('.fab-pacing');
      for (const id of ['setting-write-time', 'setting-discussion-time']) {
        const option = pacing.locator(`[data-design-id="${id}"] button`).last();
        await option.click();
        assert.equal(await option.getAttribute('aria-pressed'), 'true');
      }
      for (const id of ['setting-funny', 'setting-double']) {
        const toggle = pacing.locator(`[data-design-id="${id}"]`);
        const before = await toggle.isChecked();
        await toggle.click();
        assert.notEqual(await toggle.isChecked(), before);
        await toggle.click();
      }
      await pacing.locator('summary').evaluate(summary => {
        summary.scrollIntoView({ block: 'start' });
        scrollBy(0, -document.querySelector('.game-bar').offsetHeight - 8);
      });
      await record('fab-pacing', false);
      await open('fab-handoff');
      assert.equal(await design('question').count(),0);
      assert.equal(await design('answer-input').count(),0);
      await record('fab-handoff');
      await design('continue').click();
      await design('answer-input').fill(locale==='ar' ? 'النحاس' : 'Copper');
      await record('fab-write');
      await design('submit').click();
      assert.equal(await design('answer-input').count(),0);
      assert.equal(await design('question').count(),0);
      await open('fab-host');
      await design('continue').click();
      await design('answer-input').fill(locale==='ar' ? 'افتح يا مشمش' : 'Open, apricot!');
      await record('fab-friends-owner');
      await design('submit').click();
      assert.equal(await design('answer-input').count(),0);
      await open('fab-picture');
      await page.locator('.fab-picture-stage.is-ready').waitFor();
      await record('fab-picture-question');
      await page.locator('.fab-picture-open').click();
      assert.equal(await page.getByRole('dialog').count(),1);
      await open('fab-discussion');
      await record('fab-discussion');
      await design('continue').click();
      for (let voter=0;voter<4;voter++) {
        await page.locator('[data-testid=privacy-gate]').waitFor();
        assert.equal(await design('option').count(),0);
        await design('continue').click();
        await page.locator('button.fab-opt:disabled').waitFor();
        assert.ok(await design('submit').isDisabled());
        await page.locator('button.fab-opt:not(:disabled)').first().click();
        if(voter===0) await record('fab-private-vote');
        await design('submit').click();
      }
      await design('continue').click();
      assert.equal(await page.locator('.fab-reveal-label').count(),0);
      await design('reveal').click();
      assert.ok(await page.locator('.fab-reveal-label').count()>0);
      await open('fab-reveal');
      await checkCompactNames('.fab-roster > div > b');
      await record('fab-reveal');
      await design('reveal').click();await record('fab-round-summary');
      await open('fab-over');
      await page.locator('.fab-award-fooled').waitFor();
      const results = await page.locator('.fab-stats tbody tr').evaluateAll(rows =>
        rows.map(row => Number(row.querySelector('td:last-child').textContent)));
      assert.ok(results[0] > results[1], 'the showcase contains a genuine unique winner');
      await checkCompactNames('.choice-podium-player > b');
      await record('fab-final');
      // At a phone width, award cards need room for whole words even before the results table.
      const awardText = await page.locator('.fab-awards :is(p,small)').evaluateAll(elements => {
        const fonts = elements.map(el => [el.style.fontSize, parseFloat(getComputedStyle(el).fontSize)]);
        elements.forEach((el, i) => { el.style.fontSize = (fonts[i][1] * 2) + 'px'; });
        const split = [];
        for (const el of elements) {
          const nodes = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          while (nodes.nextNode()) {
            const node = nodes.currentNode;
            for (const match of node.textContent.matchAll(/\p{L}+/gu)) {
              const range = document.createRange();
              range.setStart(node, match.index);
              range.setEnd(node, match.index + match[0].length);
              const lines = new Set([...range.getClientRects()].map(rect => Math.round(rect.top)));
              if (lines.size > 1) split.push(match[0]);
            }
          }
        }
        elements.forEach((el, i) => { el.style.fontSize = fonts[i][0]; });
        return { fields: elements.length, split };
      });
      assert.ok(awardText.fields >= 2);
      assert.deepEqual(awardText.split, [], 'the award recipient and score explanation retain whole words at 200%');
      // Font-only zoom must preserve column associations and scores in the stacked layout.
      const table = page.locator('.fab-stats');
      const originalFont = await table.evaluate(el => el.style.fontSize);
      const originalLayout = await table.getAttribute('data-stacked');
      await table.evaluate(el => { el.style.fontSize = (2 * parseFloat(getComputedStyle(el).fontSize)) + 'px'; });
      await page.locator('.fab-stats[data-stacked="true"]').waitFor();
      const stacked = await table.evaluate(el => {
        const cols = [...el.tHead.rows[0].cells].slice(1).map(cell => cell.textContent);
        return [...el.tBodies[0].rows].map(row => ({
          labelsMatch: [...row.querySelectorAll('td')].every((cell, i) => cell.querySelector('.fab-stat-label').dataset.label === cols[i]),
          score: Number(row.cells[row.cells.length - 1].textContent),
        }));
      });
      assert.ok(stacked.every(row => row.labelsMatch));
      assert.deepEqual(stacked.map(row => row.score), results);
      await table.evaluate((el, size) => { el.style.fontSize = size; }, originalFont);
      await page.locator(`.fab-stats[data-stacked="${originalLayout}"]`).waitFor();
      const lastScore = page.locator('.fab-stats tbody tr:last-child td:last-child');
      const highlights = page.locator('.fab-highlights summary');
      for (const expanded of [false, true]) {
        if (expanded) await highlights.click();
        assert.equal(await highlights.evaluate(summary => summary.parentElement.open), expanded);
        await lastScore.scrollIntoViewIfNeeded();
        const scoreReadable = await lastScore.evaluate(cell => {
          const wrap = cell.closest('.fab-table-wrap');
          const rect = cell.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          return wrap.clientHeight >= wrap.scrollHeight - 1 && cell.contains(hit);
        });
        assert.ok(scoreReadable, 'the final score is reachable with round memories ' + (expanded ? 'open' : 'closed'));
      }
      await open('online-fab');
      await design('answer-input').fill(locale==='ar' ? 'النحاس' : 'Copper');
      await record('fab-online-write');
      await design('submit').click();
      assert.equal((await page.evaluate(()=>window.projection())).mySubmission.submitted,true);
      await page.evaluate(() => { window.reply(2,'lie',{text:'Gold'});window.reply(3,'lie',{text:'Silver'}); });
      await design('continue').click();
      await page.locator('button.fab-opt:disabled').waitFor();
      assert.equal((await page.evaluate(()=>window.projection())).options.some(option=>'truth' in option || 'owners' in option),false);
      await record('fab-online-vote');

      await open('meen-setup');
      await checkCompactNames('.players-setup-name');
      await record('meen-setup');
      const statementCount = page.locator('[data-design-id="setting-rounds"] button').last();
      await statementCount.click();
      assert.equal(await statementCount.getAttribute('aria-pressed'), 'true');
      await statementCount.evaluate(element => element.scrollIntoView({ block: 'center' }));
      await record('meen-setup-continued', false);
      await open('meen-countdown');
      await page.locator('.meen-count-beads .current').waitFor();
      assert.equal(await page.locator('.meen-count-beads .current').count(),1);
      await record('meen-countdown');
      await open('meen-pick');
      await design('option').nth(0).click();
      await design('option').nth(1).click();
      await record('meen-point-tie');
      await design('submit').click();
      assert.deepEqual(await page.locator('.meen-score-chips strong').allTextContents(),['1','1','0','0']);
      await open('meen-secret');await record('meen-pass');
      for(let voter=0;voter<4;voter++) {
        await page.locator('[data-design-screen="setup.pass-phone"]').waitFor();
        assert.equal(await design('question').count(),0);
        assert.equal(await design('option').count(),0);
        await design('continue').click();
        await design('option').nth(voter===0 ? 1 : 0).click();
        assert.equal(await design('option').filter({has:page.locator('.meen-pick-mark')}).count(),1);
        if(voter===0) await record('meen-private-vote');
        await design('submit').click();
      }
      await record('meen-reveal');
      assert.deepEqual(await page.locator('.meen-bar > b').allTextContents(),['3','1','0','0']);
      for(let round=1;round<5;round++) {
        await design('continue').click();
        await page.locator('[data-design-id="start"]').click();
        for(let voter=0;voter<4;voter++) {
          await design('continue').click();
          await design('option').nth(round % 4).click();
          await design('submit').click();
        }
      }
      await design('continue').click();
      await checkCompactNames('.choice-podium-player > b');
      await record('meen-final');
      await open('online-meen-guest');
      assert.equal(await design('scoreboard').count(),0);
      await design('abstain').click();
      assert.equal(await design('abstain').getAttribute('aria-pressed'),'true');
      await design('submit').click();
      assert.equal(await design('option').count(),0);
      assert.equal(await design('continue').count(),0);
      assert.equal(await design('scoreboard').count(),0);
      await open('online-meen');
      await design('option').nth(1).click();
      assert.deepEqual((await page.evaluate(()=>window.projection())).counts,{});
      assert.equal(await design('scoreboard').count(),0);
      for (const width of [360,430,390]) {
        await page.setViewportSize({width,height:844});
        const lines = await page.locator('.choice-room-header h1').evaluate(async title => {
          await document.fonts.ready;
          const text = document.createRange();
          text.selectNodeContents(title);
          return new Set([...text.getClientRects()].map(fragment => Math.round(fragment.top))).size;
        });
        assert.equal(lines,1,`online title fits the header at ${width}px`);
      }
      await record('meen-online-vote');
      await design('submit').click();
      await page.evaluate(() => {
        const host = window.projection().members[0].id;
        window.reply(1,'vote',{targetId:host});window.reply(2,'vote',{targetId:host});window.reply(3,'vote',{targetId:null});
      });
      await design('continue').waitFor();
      assert.equal(await design('scoreboard').count(),1);
      const publishedTallies = await page.locator('.meen-bar-tally').allTextContents();
      assert.ok(publishedTallies.some(tally => tally.includes(locale === 'en' ? '1 vote' : 'صوت واحد')));
      if (locale === 'en') assert.ok(publishedTallies.every(tally => !tally.includes('1 votes')));
      await record('meen-online-host-result');
      await design('continue').click();
      await design('option').first().waitFor();

      for (const width of [360,390,430]) {
        for (const screen of ['fab-write','meen-pick']) {
          await page.setViewportSize({width,height:844});
          await page.reload();
          await page.locator('[data-scene=fab-setup]').waitFor();
          await open(screen);
          if (width !== 390) await record(`${screen}-${width}`);
          const scaled = await page.evaluate(async () => {
            const main = document.querySelector('main');
            const elements = [main,...Array.from(main.querySelectorAll('*')).filter(element => element instanceof HTMLElement)];
            const values = elements.map(element => {
              const style = getComputedStyle(element);
              return [element,parseFloat(style.fontSize),parseFloat(style.lineHeight)];
            });
            const question = main.querySelector('[data-design-id="question"] :is(strong,p)');
            const before = parseFloat(getComputedStyle(question).fontSize);
            const root = document.documentElement;
            root.style.setProperty('font-size', '32px', 'important');
            for (const [element,size,line] of values) {
              element.style.setProperty('transition','none','important');
              element.style.setProperty('animation','none','important');
              if (Number.isFinite(size)) element.style.setProperty('font-size',2*size+'px','important');
              if (Number.isFinite(line)) element.style.setProperty('line-height',2*line+'px','important');
            }
            if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
            scrollTo(0, 0);
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            return {before,after:parseFloat(getComputedStyle(question).fontSize), inline:question.style.fontSize};
          });
          assert.ok(Math.abs(scaled.after - 2*scaled.before) < .1,`${screen}-${width}: actual question text doubled (${JSON.stringify(scaled)})`);
          await page.waitForFunction(() => getComputedStyle(document.documentElement).fontSize === '32px');
          const title = await page.locator('.game-bar .title').evaluate(element => {
            const range = document.createRange();
            range.selectNodeContents(element);
            const rects = [...range.getClientRects()];
            const bounds = element.getBoundingClientRect();
            const buttons = [...element.parentElement.querySelectorAll('button')].map(button => button.getBoundingClientRect());
            const centerY = bounds.top + bounds.height / 2;
            const aligned = buttons.length >= 2 && buttons.every(button => Math.abs(button.top + button.height / 2 - centerY) < 2);
            return { text: element.textContent, aligned, bounds: bounds.toJSON(),
              scopeFont: getComputedStyle(document.documentElement).fontSize, rects: rects.map(rect => rect.toJSON()),
              boxes: rects.length, reading: rects.every(rect => rect.left >= bounds.left - 1
              && rect.right <= bounds.right + 1 && buttons.every(button => rect.right <= button.left + 1
                || rect.left >= button.right - 1 || rect.bottom <= button.top + 1 || rect.top >= button.bottom - 1)) };
          });
          assert.ok(title.boxes && title.reading && title.aligned, `${screen}-${width}: enlarged title and header actions share one row without overlap ${JSON.stringify(title)}`);
          await record(`${screen}-${width}-text200`);
          const after = await page.locator('[data-design-id="question"] :is(strong,p)').evaluate(element => parseFloat(getComputedStyle(element).fontSize));
          assert.equal(after,scaled.after,`${screen}-${width}: actual font stays doubled after capture`);
          Object.assign(cases.at(-1),{actualQuestionFontBefore:scaled.before,actualQuestionFontAfter:after,title});
        }
      }
      assert.deepEqual(errors, []);
      if (out) await writeFile(path.join(out,`${engineName}-${locale}.json`),JSON.stringify({
        engine:engineName,locale,bundleSHA256:sha(bundle.outputFiles[0].contents),sourceSHA256,actualGameComponents:true,roomModelSnapshots:true,
        scope:'Real local reducers and room model in an isolated fixture; external transport and physical keyboard excluded',
        cases,errors,missing:await page.evaluate(()=>window.missing()),
      },null,2));
    });
  }
}

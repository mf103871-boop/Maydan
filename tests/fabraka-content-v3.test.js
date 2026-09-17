import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { arabicNormalize } from '../src/shared/lib/arabicNormalize.js';

const read = (name) => JSON.parse(readFileSync(new URL(`../src/data/games/fabraka/${name}.json`, import.meta.url), 'utf8'));
const retired = JSON.parse(readFileSync(new URL('./fixtures/fabraka-v2-retired.json', import.meta.url), 'utf8'));
const hash = (text) => createHash('sha256').update(arabicNormalize(text)).digest('hex');
const expected = { questions: { count: 100, prefix: 'fact', kind: 'text' }, pictures: { count: 32, prefix: 'picture', kind: 'picture' }, personal: { count: 48, prefix: 'friend', kind: 'friend' } };

test('Fabraka 3 replaces every old identifier and normalized prompt across all three banks', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(retired.banks).map(([name,bank])=>[name,bank.count])), { questions: 154, pictures: 12, personal: 24 }, 'the frozen baseline covers the full retired bank');
  const oldIds = new Set(Object.values(retired.banks).flatMap((bank)=>bank.ids));
  const oldTexts = new Set(Object.values(retired.banks).flatMap((bank)=>bank.textSha256));
  const ids = new Set(), texts = new Set();
  for (const [name, contract] of Object.entries(expected)) {
    const bank = read(name);
    assert.equal(bank.length,contract.count,`${name}: agreed replacement count`);
    const expectedIds = new Set(Array.from({length:contract.count},(_,index)=>`fab3-${contract.prefix}-${String(index+1).padStart(3,'0')}`));
    for (const question of bank) {
      const id = question.id;
      assert.ok(expectedIds.has(id),id);assert.equal(question.factId,id);assert.equal(question.kind,contract.kind);
      assert.equal(oldIds.has(id),false,id);assert.equal(ids.has(id),false,id);ids.add(id);
      assert.deepEqual(question.previousIds||[],[],`${id}: no retired alias`);
      const fingerprint=hash(question.text);
      assert.equal(oldTexts.has(fingerprint),false,`${id}: retired text returned with a new ID`);
      assert.equal(texts.has(fingerprint),false,`${id}: duplicate new prompt`);texts.add(fingerprint);
    }
  }
});

test('each factual card cites its verification source and each picture has a neutral asset identity', () => {
  for (const question of [...read('questions'),...read('pictures')]) {
    assert.equal(new URL(question.sourceUrl).protocol,'https:',question.id);
    assert.ok(question.sourceTitle?.trim(),question.id);
    assert.match(question.verifiedAt,/^\d{4}-\d{2}-\d{2}$/,question.id);
    if (question.kind==='picture') {
      const serial=question.id.slice(-3);
      assert.equal(question.illustration,`fab3-${serial}`);
      assert.equal(question.image,`media/fabraka-v3/fab3-${serial}.webp`);
      assert.match(question.imageCredit,/الذكاء الاصطناعي/);
      assert.ok(question.imageDescription?.trim());
      for (const truth of [question.answer,...question.aliases]) {
        assert.equal(arabicNormalize(question.imageDescription).includes(arabicNormalize(truth)),false,`${question.id}: alt reveals an accepted answer`);
      }
    }
  }
});

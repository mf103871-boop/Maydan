import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentStorage, stampContentIdentity, readSavedContentIdentity } from '../src/shared/lib/content-storage.js';

test('English history and sessions cannot overwrite legacy Arabic progress', () => {
  const values = new Map([['maydan:beep:session-v1', JSON.stringify({game:'beep',state:{phase:'intro'}})]]);
  const backend = {getItem:key=>values.get(key) ?? null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const ar=contentStorage('beep',{},backend), en=contentStorage('beep',{contentLocale:'en'},backend);
  assert.equal(ar.get('session-v1').game,'beep');
  assert.equal(en.get('session-v1'),null);
  en.set('session-v1',{contentLocale:'en',contentVersion:'new-en',game:'beep'});
  en.set('seen',{example:1});
  assert.equal(ar.get('session-v1').state.phase,'intro');
  assert.equal(ar.get('seen'),null);
  assert.equal(en.get('session-v1').contentVersion,'new-en');
  assert.throws(()=>contentStorage('beep',{contentLocale:'en',contentVersion:'retired'}),/CONTENT_VERSION/);
});

test('localized saves retain the older numeric content schema and recover their pack', () => {
  const legacy = {game:'fabraka',contentVersion:5,players:[]};
  assert.deepEqual(readSavedContentIdentity(legacy),{contentLocale:'ar',contentVersion:'legacy-ar'});
  const saved=stampContentIdentity(legacy,{contentLocale:'en'});
  assert.equal(saved.contentVersion,5);
  assert.equal(saved.contentPackVersion,'new-en');
  assert.deepEqual(readSavedContentIdentity(saved),{contentLocale:'en',contentVersion:'new-en'});
  assert.equal(stampContentIdentity({game:'beep'},{contentLocale:'en'}).contentVersion,'new-en');
  assert.throws(()=>readSavedContentIdentity({...saved,contentPackVersion:'missing'}),/CONTENT_VERSION/);
});

test('Badeeha legacy bank versions remain resumable and are never replaced by locale versions', () => {
  const legacy = {game:'badeeha',contentVersion:'badeeha-quality-2026-10-08',used:{one:true}};
  assert.deepEqual(readSavedContentIdentity(legacy),{contentLocale:'ar',contentVersion:'legacy-ar'});
  const saved=stampContentIdentity(legacy,{contentLocale:'en'});
  assert.equal(saved.contentVersion,legacy.contentVersion);
  assert.deepEqual(saved.used,{one:true});
  assert.equal(saved.contentPackVersion,'new-en');
  assert.deepEqual(readSavedContentIdentity(saved),{contentLocale:'en',contentVersion:'new-en'});
});

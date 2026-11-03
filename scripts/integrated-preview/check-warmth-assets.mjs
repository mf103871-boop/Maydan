import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import { localAudioManifestFiles } from '../audio-review/server.mjs';
import { createLocalAudition } from '../../src/shared/fx/local-audition.js';
const folder='C:/Users/user/Documents/Codex/2026-10-01/new-chat/outputs/maydan-warmth-20261103/assets';
const pack=JSON.parse(await readFile(path.join(folder,'manifest.json'),'utf8'));
globalThis.__MAYDAN_LOCAL_AUDIO_REVIEW__=true;
globalThis.window={location:{href:'http://127.0.0.1:4186/'}};
const files=localAudioManifestFiles(pack);
for(const [url,file] of files){const p=path.join(folder,url);assert.equal(createHash('sha256').update(await readFile(p)).digest('hex'),file.sha256);if(file.bytes!==undefined)assert.equal((await stat(p)).size,file.bytes);}
const audition=createLocalAudition({pack,baseUrl:'/audio-preview/',mode:'candidate',directionId:'bossaAlternative'});
assert.equal(audition.suites['warmth-long'].suiteTracks.length,4);
assert.equal(audition.directions.bossaAlternative.home,'warmth-long');
assert.equal(audition.directions.bossaAlternative.mafiaNight,null);
assert.equal(audition.cues.timerWarning,'sfx-clock');
assert.ok(audition.assets['sfx-clock'].seconds<=.85);
console.log(JSON.stringify({filesVerified:files.size,suiteTracks:4,totalSeconds:audition.suites['warmth-long'].seconds,clockSeconds:audition.assets['sfx-clock'].seconds,productionActivated:pack.productionActivated}));

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { CANDIDATE_BUNDLE_ID, CANDIDATE_FILES, CANDIDATE_AUDITIONS, CANDIDATE_SCENES, CANDIDATE_EFFECTS } from '../src/shared/fx/audio-candidate-catalog.js';

const sceneSources = { home: 'menus', badeeha: 'badeeha', ersomha: 'ersomha', fabraka: 'fabraka', meenfina: 'meenfina', jabeen: 'jabeen', mamnoo: 'mamnoo', beep: 'beep', mafia: 'mafia' };
const effectSources = { click: 'click', pop: 'select', correct: 'correct', wrong: 'wrong', win: 'win', pass: 'pass', tick: 'clock', tickFast: 'clock', mafiaAssassination: 'mafia-assassination', mafiaJudgment: 'mafia-judgment' };

test('the catalog is metadata for 24 full auditions and ten effects, with immutable private-only approval flags', () => {
  assert.equal(CANDIDATE_BUNDLE_ID, 'pixabay-candidates-20261030-v1');
  assert.equal(CANDIDATE_FILES.length, 34); assert.equal(Object.keys(CANDIDATE_AUDITIONS).length, 24);
  assert.equal(Object.keys(CANDIDATE_EFFECTS).length, 10);
  assert.equal(new Set(CANDIDATE_FILES.map(entry => entry.id)).size, 34);
  assert.equal(new Set(CANDIDATE_FILES.map(entry => entry.url)).size, 34);
  for (const entry of CANDIDATE_FILES) {
    assert.equal(entry.licenseVerified, true); assert.equal(entry.listeningApproved, false);
    assert.equal(entry.candidateForPrivateTest, true); assert.equal(entry.acousticAuthenticityVerified, false);
    assert.equal(entry.status, 'private-testflight-candidate'); assert.equal(Object.isFrozen(entry), true);
    assert.throws(() => { entry.listeningApproved = true; }, TypeError);
  }
  assert.equal(Object.isFrozen(CANDIDATE_FILES), true);
});

test('every file has an exact local content-addressed path, positive decoded frame metadata and separate PCM master identity', () => {
  for (const entry of CANDIDATE_FILES) {
    assert.match(entry.url, /^audio\/candidates\/[a-z\d-]+-[a-f\d]{12}\.m4a$/);
    assert.equal(path.posix.basename(entry.url), `${entry.id}-${entry.sha256.slice(0, 12)}.m4a`);
    for (const digest of [entry.sha256, entry.masterSha256, entry.sourceOriginalSha256]) assert.match(digest, /^[a-f\d]{64}$/);
    assert.ok(Number.isSafeInteger(entry.bytes) && entry.bytes > 0);
    assert.ok(Number.isSafeInteger(entry.frames) && entry.frames > 0);
    assert.ok(Number.isSafeInteger(entry.masterFrames) && entry.masterFrames > 0);
    assert.ok([24000, 44100, 48000].includes(entry.sampleRate)); assert.ok([1, 2].includes(entry.channels));
    assert.ok(Math.abs(entry.seconds - entry.frames / entry.sampleRate) < 1e-8);
    assert.equal(new URL(entry.sourceUrl).hostname, 'pixabay.com');
    assert.equal(entry.licenseUrl, 'https://pixabay.com/service/license-summary/');
  }
});

test('scene mapping uses the preserved full audition entry and does not silently add unimplemented ambience/transition routes', () => {
  assert.deepEqual(Object.keys(CANDIDATE_SCENES).sort(), Object.keys(sceneSources).sort());
  for (const [scene, source] of Object.entries(sceneSources)) {
    assert.equal(CANDIDATE_SCENES[scene], CANDIDATE_AUDITIONS[source]);
    assert.equal(CANDIDATE_SCENES[scene].processing.preservedFullAudition, true);
    assert.equal(CANDIDATE_SCENES[scene].processing.cropped, false);
  }
  assert.equal(CANDIDATE_SCENES['mafia-ambience'], undefined); assert.equal(CANDIDATE_SCENES['mafia-transition'], undefined);
});

test('runtime effects use approved source destinations, deterministic transient crops and attenuation without pitch synthesis', () => {
  assert.deepEqual(Object.keys(CANDIDATE_EFFECTS).sort(), Object.keys(effectSources).sort());
  for (const [cue, source] of Object.entries(effectSources)) {
    const entry = CANDIDATE_EFFECTS[cue], edit = entry.processing;
    assert.equal(entry.sourceId, source); assert.equal(entry.sampleRate, 48000);
    assert.ok(entry.seconds > 0 && entry.seconds <= 5);
    assert.equal(edit.pitchSemitones, 0); assert.ok(edit.attenuationDb <= 0);
    assert.ok(edit.measuredTruePeakDbtp <= -6.1);
    assert.equal(edit.sourceEndFrame48k - edit.sourceStartFrame48k, entry.masterFrames);
    assert.ok(edit.fadeInFrames > 0 && edit.fadeOutFrames > 0);
    assert.ok(Math.abs(entry.frames - entry.masterFrames) <= 2048, 'only normal AAC frame padding is allowed');
  }
  for (const source of ['lose', 'card', 'pencil']) assert.equal(CANDIDATE_EFFECTS[source], undefined, 'manual auditions do not invent a gameplay event');
});

test('both clock cues share the same physical hit without a pitch, tempo or hidden-time variation', () => {
  assert.equal(CANDIDATE_EFFECTS.tick.sha256, CANDIDATE_EFFECTS.tickFast.sha256);
  assert.equal(CANDIDATE_EFFECTS.tick.masterSha256, CANDIDATE_EFFECTS.tickFast.masterSha256);
  assert.equal(CANDIDATE_EFFECTS.tick.processing.sourceStartFrame48k, CANDIDATE_EFFECTS.tickFast.processing.sourceStartFrame48k);
  assert.equal(CANDIDATE_EFFECTS.tick.processing.sourceEndFrame48k, CANDIDATE_EFFECTS.tickFast.processing.sourceEndFrame48k);
});

test('all full audition entries retain their original sample rate and no cropped effect can replace the manual source', () => {
  for (const [id, entry] of Object.entries(CANDIDATE_AUDITIONS)) {
    assert.equal(entry.id, `audition-${id}`); assert.equal(entry.sourceId, id);
    assert.equal(entry.masterFrames, entry.frames); assert.equal(entry.processing.preservedFullAudition, true);
  }
  assert.equal(CANDIDATE_AUDITIONS.pencil.sampleRate, 24000);
  assert.equal(CANDIDATE_AUDITIONS['mafia-assassination'].sampleRate, 24000);
  assert.notEqual(CANDIDATE_AUDITIONS['mafia-assassination'].url, CANDIDATE_EFFECTS.mafiaAssassination.url);
});

const mediaRoot = process.env.MAYDAN_CANDIDATE_ASSET_ROOT;
test('the private pack files exactly match every public catalog byte/hash without escaping their supplied root', { skip: !mediaRoot }, () => {
  const root = realpathSync(mediaRoot);
  for (const entry of CANDIDATE_FILES) {
    const target = realpathSync(path.join(root, entry.url));
    assert.equal(path.relative(root, target).startsWith('..'), false);
    const bytes = readFileSync(target);
    assert.equal(bytes.length, entry.bytes, entry.id);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, entry.id);
  }
});

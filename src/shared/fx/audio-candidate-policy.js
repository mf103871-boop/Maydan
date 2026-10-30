import { configuredBuildOrigin, isMafiaPreview, MAFIA_PREVIEW_API_ORIGIN } from '../lib/environment.js';

// Both values are compile-time release inputs. A URL, preference, account flag,
// localStorage value, or a normal Mafia preview build cannot enable this pack.
export function isPrivateAudioCandidateBuild() {
  return typeof __MAYDAN_AUDIO_PREVIEW__ !== 'undefined' && __MAYDAN_AUDIO_PREVIEW__ === true &&
    typeof __MAYDAN_ROOMS_URL__ === 'string' && __MAYDAN_ROOMS_URL__ === MAFIA_PREVIEW_API_ORIGIN &&
    isMafiaPreview(configuredBuildOrigin());
}

export function validPrivateAudioCandidate(entry, { effect = false } = {}) {
  return !!entry && entry.candidateForPrivateTest === true && entry.licenseVerified === true &&
    entry.listeningApproved === false && /^[a-z\d-]+$/.test(entry.id || '') &&
    /^audio\/candidates\/[a-z\d-]+-[a-f\d]{12}\.m4a$/.test(entry.url || '') &&
    /^[a-f\d]{64}$/.test(entry.sha256 || '') && /^https:\/\/pixabay\.com\//.test(entry.sourceUrl || '') &&
    Number.isSafeInteger(entry.frames) && entry.frames > 0 &&
    Number.isFinite(entry.seconds) && entry.seconds > 0 &&
    Number.isSafeInteger(entry.bytes) && entry.bytes > 0 &&
    Number.isSafeInteger(entry.sampleRate) && entry.sampleRate >= 8000 && entry.sampleRate <= 96000 &&
    Number.isSafeInteger(entry.channels) && entry.channels >= 1 && entry.channels <= 2 &&
    Math.abs(entry.seconds - entry.frames / entry.sampleRate) < 0.002 &&
    (!effect || entry.sampleRate === 48000 && entry.frames <= 48000 * 5 && entry.bytes <= 1024 * 1024);
}

export function privateCandidateEffects(entries) {
  if (!isPrivateAudioCandidateBuild()) return {};
  const allowed = new Set(['click', 'pop', 'correct', 'wrong', 'win', 'pass', 'tick', 'tickFast', 'mafiaAssassination', 'mafiaJudgment']);
  return Object.fromEntries(Object.entries(entries || {}).filter(([cue, entry]) => allowed.has(cue) && validPrivateAudioCandidate(entry, { effect: true })));
}

// Owns playback and suppression only. Native controls initiate playback; this
// controller never calls play(), resumes interrupted audio, or requests a mic.
export function createCandidatePlaybackSession(sound, { available = () => true, activity = () => {}, owner = Symbol('audio-candidate-lab') } = {}) {
  const elements = new Map();
  let active = false, current = null;
  const authorized = () => active && isPrivateAudioCandidateBuild() && available();
  const retire = element => {
    try { element.pause(); element.removeAttribute('src'); element.load(); } catch { /* detached media */ }
  };
  const interrupt = () => {
    current = null;
    for (const element of elements.keys()) retire(element);
    activity(false);
  };
  const restore = () => {
    if (!authorized()) return;
    for (const [element, entry] of elements) if (element.getAttribute('src') !== entry.url) element.setAttribute('src', entry.url);
  };
  return {
    activate() {
      if (!isPrivateAudioCandidateBuild()) return false;
      active = true;
      sound.setSuppressed?.(true, owner); sound.music?.setSuppressed?.(true, owner); sound.setDucking?.(true, owner);
      restore(); return true;
    },
    register(element, entry) {
      if (!element || !validPrivateAudioCandidate(entry)) return () => {};
      elements.set(element, entry);
      if (authorized()) element.setAttribute('src', entry.url);
      return () => { elements.delete(element); retire(element); if (current === element) { current = null; activity(false); } };
    },
    onPlay(element) {
      const entry = elements.get(element);
      if (!authorized() || !entry || element.paused || element.getAttribute('src') !== entry.url) { retire(element); return false; }
      for (const other of elements.keys()) if (other !== element) { try { other.pause(); } catch { /* retired */ } }
      current = element; activity(true); return true;
    },
    onPause(element) { if (current === element && element.paused) { current = null; activity(false); } },
    interrupt, restore,
    dispose() {
      active = false; interrupt();
      sound.setDucking?.(false, owner); sound.setSuppressed?.(false, owner); sound.music?.setSuppressed?.(false, owner);
    },
  };
}

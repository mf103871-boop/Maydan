// Local listening preview only. Each chapter is a distinct compressed recording;
// no full-length PCM decoding and no simultaneous tonal crossfade. The common
// sound bus continues to own volume, speech ducking and privacy suppression.
export function createStreamingSuite(suite, { onFailure = () => {}, random = Math.random } = {}) {
  let graph = null, destination = null, scene = null, running = false, failed = false;
  let active = null, prepared = null, epoch = 0, index = 0, position = 0, cycle = 1, elapsed = 0, completed = false, skipTimer = null;
  const slots = new Set(), listeners = new Set(), unavailable = new Set(), resumeFailures = new Set();
  let bag = [], nextCycleBag = null;
  const introIndex = () => suite.suiteTracks.findIndex(track => track.id === suite.introTrackId);
  const recurring = () => suite.suiteTracks.map((_, i) => i).filter(i => i !== introIndex());
  const positionOf = () => active?.seekPending ? active.resumeAt : active && Number.isFinite(active.audio.currentTime) ? Math.max(0, active.audio.currentTime) : position;
  const seconds = () => active && Number.isFinite(active.audio.duration) && active.audio.duration > 0 ? active.audio.duration : suite.suiteTracks[index].seconds;
  const supported = context => !failed && typeof window !== 'undefined' && typeof window.Audio === 'function' && typeof context?.createMediaElementSource === 'function';
  function shuffle(values, previous = -1) {
    const result = [...values];
    for (let i = result.length - 1; i > 0; i--) {
      const sample = Number(random());
      const j = Math.floor((Number.isFinite(sample) ? Math.max(0, Math.min(.999999999, sample)) : 0) * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    if (result.length > 1 && result[0] === previous) [result[0], result[1]] = [result[1], result[0]];
    return result;
  }
  function initialise() {
    index = Math.max(0, introIndex()); position = 0; cycle = 1; elapsed = 0; completed = false; failed = false;
    bag = shuffle(recurring().filter(i => i !== index)); nextCycleBag = null; unavailable.clear(); resumeFailures.clear();
  }
  initialise();
  function status() {
    const track = suite.suiteTracks[index];
    const at = Math.min(track.seconds, positionOf());
    return Object.freeze({ mode: 'suite', suiteId: suite.id, title: suite.title, trackId: track.id, trackTitle: track.title || track.id,
      chapter: index + 1, chapterCount: suite.suiteTracks.length, position: at, chapterSeconds: track.seconds,
      uniqueSeconds: suite.seconds, elapsedSeconds: elapsed + (completed ? 0 : at), cycle, repeat: suite.repeat === true,
      state: failed ? 'failed' : completed ? 'ended' : active?.blocked ? 'gesture-required' : running && active && !active.seekPending && !active.audio.paused ? 'playing' : 'paused',
      decoderCount: slots.size, transition: 'fade-out-then-in', transitioning: !!skipTimer, introOnce: !!suite.introTrackId,
      unavailableTrackIds: Object.freeze([...unavailable].map(i => suite.suiteTracks[i].id)), resumeFailedTrackIds: Object.freeze([...resumeFailures].map(i => suite.suiteTracks[i].id)), degraded: unavailable.size > 0 });
  }
  function notify() { const value = status(); for (const fn of listeners) { try { fn(value); } catch { /* a preview panel cannot stop audio */ } } }
  function remove(slot) {
    if (!slot || !slots.delete(slot)) return;
    slot.attempt++; clearTimeout(slot.seekTimer);
    slot.audio.onplaying = null; slot.audio.ontimeupdate = null; slot.audio.onended = null; slot.audio.onerror = null; slot.audio.onloadedmetadata = null; slot.audio.onseeked = null; slot.audio.oncanplay = null;
    try { slot.audio.pause(); slot.audio.removeAttribute('src'); slot.audio.load(); } catch { /* already detached */ }
    try { slot.node.disconnect(); slot.gain.disconnect(); } catch { /* retired graph */ }
    if (active === slot) active = null;
    if (prepared === slot) prepared = null;
  }
  const live = slot => slots.has(slot) && slot.epoch === epoch;
  function failAll(recordingFailure = true) {
    position = positionOf();
    failed = true; running = false; epoch++; clearTimeout(skipTimer); skipTimer = null;
    for (const item of [...slots]) remove(item);
    notify(); if (recordingFailure) onFailure();
  }
  function fail(slot, { resume = false } = {}) {
    if (!live(slot)) return;
    if (resume) { resumeFailures.add(slot.index); failAll(false); return; }
    unavailable.add(slot.index);
    bag = bag.filter(i => !unavailable.has(i));
    if (nextCycleBag) nextCycleBag = nextCycleBag.filter(i => !unavailable.has(i));
    // A failed speculative load cannot cut a healthy chapter already playing.
    // Mark it unavailable for this session, without a network retry loop.
    if (slot !== active) { remove(slot); notify(); return; }
    // A metadata error can arrive while private/background audio is paused.
    // Stop visibly, never start a replacement chapter from that callback.
    if (!running) { failAll(); return; }
    if (!suite.suiteTracks.some((_, i) => i !== index && !unavailable.has(i) && i !== introIndex())) { failAll(); return; }
    advance({ skipped: true });
  }
  function armSeekTimeout(slot) {
    if (!slot.seekPending || slot.seekTimer || !running || active !== slot) return;
    slot.seekTimer = setTimeout(() => { slot.seekTimer = null; if (live(slot) && running && active === slot && slot.seekPending) fail(slot, { resume: true }); }, 5000);
    slot.seekTimer.unref?.();
  }
  function seek(slot, at) {
    slot.seekPending = true; slot.resumeAt = at;
    const audio = slot.audio;
    let requestedState = -1;
    const check = () => {
      if (!live(slot) || !slot.seekPending || slot.blocked || !running || active !== slot) return;
      const ready = audio.readyState ?? 4;
      if (ready < 1 || audio.seeking) return;
      const atCheckpoint = () => Number.isFinite(audio.currentTime) && Math.abs(audio.currentTime - at) <= .25;
      if (requestedState < 0 || (ready > requestedState && !atCheckpoint())) {
        requestedState = ready;
        try { audio.currentTime = at; } catch { requestedState = -1; return; }
      }
      if (ready < 2 || audio.seeking || !atCheckpoint()) return;
      slot.seekPending = false; clearTimeout(slot.seekTimer); slot.seekTimer = null;
      slot.checkSeek = audio.onloadedmetadata = audio.onseeked = audio.oncanplay = null;
      playSlot(slot, .35);
    };
    slot.checkSeek = audio.onloadedmetadata = audio.onseeked = audio.oncanplay = check;
  }
  function makeSlot(nextIndex) {
    const recording = suite.suiteTracks[nextIndex]; let audio, node, gain;
    try {
      audio = new window.Audio(); audio.preload = 'auto'; audio.setAttribute('playsinline', ''); audio.src = recording.url;
      node = graph.createMediaElementSource(audio); gain = graph.createGain();
      gain.gain.value = 0; node.connect(gain); gain.connect(destination);
    } catch (error) {
      try { audio?.pause(); audio?.removeAttribute('src'); audio?.load(); node?.disconnect(); gain?.disconnect(); } catch { /* partial decoder */ }
      throw error;
    }
    const slot = { audio, node, gain, recording, index: nextIndex, epoch, attempt: 0, blocked: false, fading: false, seekPending: false, seekTimer: null, resumeAt: 0 };
    slots.add(slot);
    audio.onerror = () => fail(slot);
    audio.ontimeupdate = () => {
      if (!live(slot) || active !== slot || !running) return;
      if (slot.seekPending) { slot.checkSeek(); return; }
      if (audio.paused) return;
      position = Math.max(0, Number(audio.currentTime) || 0);
      const remaining = seconds() - position;
      // Prepare only one subsequent decoder and only near the boundary. Do not
      // consume its place in the bag until the previous chapter actually ends.
      if (remaining <= 15 && remaining > 0 && !prepared) {
        if (!bag.length && suite.repeat === true && !nextCycleBag) {
          const choices = recurring().filter(i => !unavailable.has(i));
          nextCycleBag = choices.length === 1 && choices[0] === index ? [] : shuffle(choices, index);
        }
        const nextIndex = bag[0] ?? nextCycleBag?.[0];
        if (nextIndex !== undefined) {
          try { prepared = makeSlot(nextIndex); } catch {
            unavailable.add(nextIndex); bag = bag.filter(i => i !== nextIndex); if (nextCycleBag) nextCycleBag = nextCycleBag.filter(i => i !== nextIndex); notify();
          }
        }
      }
      if (remaining > 0 && remaining <= suite.transitionSeconds && !slot.fading) {
        slot.fading = true;
        try {
          gain.gain.cancelScheduledValues(graph.currentTime);
          gain.gain.setValueAtTime(gain.gain.value, graph.currentTime);
          gain.gain.linearRampToValueAtTime(0, graph.currentTime + remaining);
        } catch { gain.gain.value = 0; }
      }
      notify();
    };
    audio.onended = () => {
      if (!live(slot) || slot !== active || !running || slot.seekPending) return;
      advance();
    };
    return slot;
  }
  function playSlot(slot, fadeSeconds = suite.transitionSeconds) {
    if (!live(slot) || !running || slot !== active) return;
    if (slot.seekPending) {
      slot.blocked = false; armSeekTimeout(slot); slot.checkSeek();
      if (!slot.seekPending || slot.primed) return;
      // WebKit can defer fetching metadata until play(). The new node stays
      // at zero gain until this exact chapter has data at the saved position.
      slot.primed = true;
    }
    const attempt = ++slot.attempt;
    let beganAlready = false;
    const valid = () => live(slot) && running && active === slot && attempt === slot.attempt;
    const began = () => {
      if (!valid()) {
        // A stale promise may belong to an earlier play() on this same element.
        // Do not pause a newer, authorised resume; do stop retired/hidden media.
        if (!live(slot) || !running || active !== slot) { try { slot.audio.pause(); } catch { /* retired */ } }
        return;
      }
      if (slot.seekPending) { slot.checkSeek(); return; }
      if (beganAlready) return;
      beganAlready = true;
      slot.audio.onplaying = null; slot.blocked = false; slot.fading = false;
      try {
        slot.gain.gain.cancelScheduledValues(graph.currentTime);
        slot.gain.gain.setValueAtTime(0, graph.currentTime);
        slot.gain.gain.linearRampToValueAtTime(1, graph.currentTime + Math.max(.1, Math.min(2, fadeSeconds)));
      } catch { slot.gain.gain.value = 1; }
      notify();
    };
    const rejected = error => {
      if (!valid()) return;
      if (error?.name === 'NotAllowedError' || error?.name === 'AbortError') {
        slot.blocked = true; slot.primed = false; clearTimeout(slot.seekTimer); slot.seekTimer = null;
        try { slot.audio.pause(); } catch { /* detached */ }
        notify();
      } else fail(slot);
    };
    slot.audio.onplaying = began;
    try { Promise.resolve(slot.audio.play()).then(began, rejected); } catch (error) { rejected(error); }
  }
  function advance({ skipped = false } = {}) {
    if (!running || failed || completed) return;
    clearTimeout(skipTimer); skipTimer = null;
    const previous = index;
    elapsed += skipped ? positionOf() : suite.suiteTracks[index].seconds;
    if (!bag.length) {
      if (suite.repeat !== true) {
        position = suite.suiteTracks[index].seconds; completed = true; running = false;
        for (const slot of [...slots]) remove(slot);
        notify(); return;
      }
      const choices = recurring().filter(i => !unavailable.has(i));
      bag = nextCycleBag || (choices.length === 1 && choices[0] === previous ? [] : shuffle(choices, previous)); nextCycleBag = null;
      if (!bag.length) { failAll(); return; }
      cycle++; elapsed = 0;
    }
    const nextIndex = bag.shift(), next = prepared?.index === nextIndex ? prepared : null;
    for (const slot of [...slots]) if (slot !== next) remove(slot);
    prepared = null; index = nextIndex; position = 0;
    try { active = next || makeSlot(index); playSlot(active); } catch { failed = true; running = false; for (const slot of [...slots]) remove(slot); notify(); onFailure(); }
  }
  const api = {
    supported,
    setTrack(next) {
      if (next.url === suite.url) return;
      this.reset(); suite = next; initialise(); notify();
    },
    play(context, output, id) {
      if (!supported(context)) return false;
      scene = id;
      if (completed) return true;
      if (graph !== context || destination !== output) { this.reset(); graph = context; destination = output; }
      running = true;
      if (!active) {
        try {
          const slot = makeSlot(index); active = slot;
          if (position > 0) seek(slot, position);
          playSlot(slot, position > 0 ? .35 : suite.transitionSeconds);
        }
        catch { failed = true; running = false; for (const slot of [...slots]) remove(slot); notify(); onFailure(); return false; }
      } else if (active.seekPending || active.audio.paused) {
        if (!active.seekPending && position >= seconds() - .01) advance(); else playSlot(active, .35);
      }
      notify(); return !failed;
    },
    pause({ clear = false } = {}) {
      running = false;
      clearTimeout(skipTimer); skipTimer = null;
      if (active) {
        position = positionOf(); active.attempt++; active.primed = false;
        clearTimeout(active.seekTimer); active.seekTimer = null;
        active.audio.onplaying = null;
        try { active.audio.pause(); active.gain.gain.cancelScheduledValues(graph.currentTime); active.gain.gain.value = 0; } catch { /* already retired */ }
      }
      if (prepared) remove(prepared);
      if (clear) scene = null;
      notify();
    },
    reset() {
      if (active) position = positionOf();
      epoch++; running = false; clearTimeout(skipTimer); skipTimer = null;
      for (const slot of [...slots]) remove(slot);
      graph = null; destination = null; notify();
    },
    dispose() { this.reset(); scene = null; initialise(); notify(); },
    getStatus: status,
    retry() {
      if (!failed) return false;
      this.reset(); failed = false; completed = false;
      if (!resumeFailures.has(index)) { unavailable.clear(); bag = shuffle(recurring().filter(i => i !== index)); nextCycleBag = null; }
      resumeFailures.clear(); notify(); return true;
    },
    skipNext() {
      if (!running || failed || completed || !active || active.seekPending || active.audio.paused || skipTimer) return false;
      const slot = active, generation = epoch;
      try { slot.gain.gain.cancelScheduledValues(graph.currentTime); slot.gain.gain.setValueAtTime(slot.gain.gain.value, graph.currentTime); slot.gain.gain.linearRampToValueAtTime(0, graph.currentTime + suite.transitionSeconds); } catch { slot.gain.gain.value = 0; }
      skipTimer = setTimeout(() => { skipTimer = null; if (running && live(slot) && active === slot && generation === epoch) advance({ skipped: true }); }, suite.transitionSeconds * 1000);
      skipTimer.unref?.(); notify(); return true;
    },
    subscribeStatus(fn) { if (typeof fn !== 'function') return () => {}; listeners.add(fn); try { fn(status()); } catch { /* local observer */ } return () => listeners.delete(fn); },
    get current() { return active && running && !active.seekPending && !active.audio.paused ? scene : null; },
    get position() { return positionOf(); },
    get decoderCount() { return slots.size; },
  };
  return api;
}

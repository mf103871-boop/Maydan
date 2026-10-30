// The eight-minute recording stays in the media decoder. Never fetch/decode it
// as an AudioBuffer: 48 kHz stereo Float32 would consume ~184 MB on an iPhone.
// WebKit's bundled maydan: handler already serves audio/mp4 byte ranges.
export function createStreamingMusic(track, { onFailure = () => {} } = {}) {
  let active = null;
  let graph = null;
  let scene = null;
  let position = 0;
  let failed = false;
  let running = false;
  let epoch = 0;
  const slots = new Set();
  const positions = new Map();
  const supported = (context) => !failed && typeof window !== 'undefined' && typeof window.Audio === 'function' && typeof context?.createMediaElementSource === 'function';

  function remove(slot) {
    if (!slot || !slots.delete(slot)) return;
    clearTimeout(slot.timer);
    slot.audio.ontimeupdate = null; slot.audio.onended = null; slot.audio.onerror = null; slot.audio.onloadedmetadata = null; slot.audio.onplaying = null;
    try { slot.audio.pause(); slot.audio.removeAttribute('src'); slot.audio.load(); } catch { /* detached */ }
    try { slot.node.disconnect(); slot.gain.disconnect(); } catch { /* graph retired */ }
    if (active === slot) active = null;
  }
  function fail(slot) {
    if (!slots.has(slot) || slot.epoch !== epoch) return;
    if (slot !== active) { remove(slot); return; }
    position = Math.max(0, Number(active?.audio.currentTime) || position);
    failed = true;
    for (const item of [...slots]) remove(item);
    onFailure();
  }
  function overlap(context, previous, next, seconds) {
    // Wait for actual playback, rather than fading the old track while WebKit is
    // still loading the replacement. Privacy interruptions bypass this fade.
    const begin = () => {
      if (!running || active !== next || !slots.has(next) || next.epoch !== epoch) return;
      next.audio.onplaying = null;
      next.pendingFrom = null;
      if (!slots.has(previous)) { next.gain.gain.value = 1; return; }
      const fade = Math.min(3, Math.max(0.1, seconds));
      try {
        previous.gain.gain.cancelScheduledValues(context.currentTime);
        previous.gain.gain.setValueAtTime(previous.gain.gain.value, context.currentTime);
        previous.gain.gain.linearRampToValueAtTime(0, context.currentTime + fade);
        next.gain.gain.setValueAtTime(0, context.currentTime);
        next.gain.gain.linearRampToValueAtTime(1, context.currentTime + fade);
      } catch { next.gain.gain.value = 1; remove(previous); return; }
      previous.timer = setTimeout(() => remove(previous), fade * 1000 + 60);
      previous.timer.unref?.();
    };
    next.audio.onplaying = begin;
    return begin;
  }
  function start(context, destination, at, initialGain = 1, previous = null, fadeSeconds = 1.5) {
    const recording = track;
    const audio = new window.Audio();
    audio.preload = 'metadata'; audio.setAttribute('playsinline', '');
    audio.src = recording.url;
    const node = context.createMediaElementSource(audio);
    const gain = context.createGain(); gain.gain.value = initialGain;
    node.connect(gain); gain.connect(destination);
    const slot = { audio, node, gain, recording, epoch, timer: null, fading: false, pendingFrom: previous };
    slots.add(slot); active = slot;
    if (at > 0) {
      // Setting currentTime can throw before WebKit has read the local metadata.
      try { audio.currentTime = at; } catch {
        audio.onloadedmetadata = () => {
          audio.onloadedmetadata = null;
          if (slots.has(slot) && slot.epoch === epoch) { try { audio.currentTime = at; } catch { /* start naturally */ } }
        };
      }
    }
    audio.onerror = () => fail(slot);
    audio.ontimeupdate = () => {
      if (active !== slot || slot.fading || audio.paused || slot.epoch !== epoch) return;
      const duration = Number.isFinite(audio.duration) ? audio.duration : recording.seconds;
      const remaining = duration - audio.currentTime;
      if (remaining <= 0 || remaining > recording.crossfadeSeconds || audio.currentTime < 1) return;
      slot.fading = true;
      // At most two small streaming decoders during the loop overlap. Neither
      // recording is read into JavaScript or expanded into a full PCM buffer.
      for (const item of [...slots]) if (item !== slot) remove(item);
      try { start(context, destination, 0, 0, slot, Math.min(recording.crossfadeSeconds, remaining)); } catch { fail(slot); }
    };
    audio.onended = () => {
      if (!running) return;
      if (active !== slot || slot.epoch !== epoch) { remove(slot); return; }
      remove(slot); position = 0;
      try { start(context, destination, 0); } catch { failed = true; onFailure(); }
    };
    if (previous) overlap(context, previous, slot, fadeSeconds);
    try {
      Promise.resolve(audio.play()).catch((error) => {
        // Autoplay may need the next gesture. It is not an asset failure and
        // must not permanently downgrade to the old short recording.
        if (error?.name !== 'NotAllowedError' && error?.name !== 'AbortError') fail(slot);
      });
    } catch (error) { if (error?.name !== 'NotAllowedError') fail(slot); }
    return slot;
  }
  return {
    setTrack(next) {
      if (!next?.url || next.url === track.url) return;
      positions.set(track.url, active?.recording.url === track.url ? Number(active.audio.currentTime) || 0 : position);
      // Keep the live decoder until play() can overlap it in the same graph.
      // A paused/background transition has nothing audible to crossfade.
      if (!running || !active || active.audio.paused) this.reset();
      track = next; position = positions.get(next.url) || 0; failed = false; scene = null;
    },
    supported,
    play(context, destination, id) {
      if (!supported(context)) return false;
      scene = id;
      if (graph !== context) {
        this.reset(); graph = context;
      }
      running = true;
      if (active && active.recording.url !== track.url) {
        // If navigation changes again before playback starts, retain the last
        // audible track and discard the unstarted intermediate decoder.
        const previous = slots.has(active.pendingFrom) ? active.pendingFrom : active;
        for (const item of [...slots]) if (item !== previous) remove(item);
        try { start(context, destination, position % track.seconds, 0, previous, track.sceneCrossfadeSeconds ?? 1.5); }
        catch { failed = true; for (const item of [...slots]) remove(item); onFailure(); return false; }
      } else if (!active) {
        try { start(context, destination, position % track.seconds); } catch { failed = true; onFailure(); return false; }
      } else if (active.audio.paused) {
        const slot = active;
        try { Promise.resolve(slot.audio.play()).catch((error) => { if (error?.name !== 'NotAllowedError' && error?.name !== 'AbortError') fail(slot); }); } catch { /* retry on gesture */ }
      }
      return !failed;
    },
    pause({ clear = false } = {}) {
      running = false;
      if (active) position = Math.max(0, Number(active.audio.currentTime) || 0);
      // Retire the outgoing half of an overlap so background/foreground cannot
      // resume two full-volume copies of the recording.
      for (const slot of [...slots]) {
        if (slot !== active) remove(slot);
        else {
          slot.audio.onplaying = null;
          try { slot.audio.pause(); slot.gain.gain.cancelScheduledValues(graph.currentTime); slot.gain.gain.value = 1; } catch { /* retired */ }
        }
      }
      if (clear) scene = null;
    },
    reset() {
      if (active) {
        const at = Math.max(0, Number(active.audio.currentTime) || 0);
        positions.set(active.recording.url, at);
        if (active.recording.url === track.url) position = at;
      }
      epoch += 1;
      running = false;
      for (const slot of [...slots]) remove(slot);
      graph = null;
    },
    dispose() { this.reset(); position = 0; scene = null; positions.clear(); },
    get current() { return active && !active.audio.paused ? scene : null; },
    get position() { return active ? Number(active.audio.currentTime) || 0 : position; },
    get decoderCount() { return slots.size; },
  };
}

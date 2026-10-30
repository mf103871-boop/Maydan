// Yield only elective downloads. Foreground media, sockets and audio keep their
// existing owners; pausing never cancels an image body already being saved.
export function shouldPauseStartupImages({ route, call, connecting, mafiaVoice, audio, hidden } = {}) {
  return ['play', 'online', 'room'].includes(route) || !!(call || connecting || mafiaVoice || audio || hidden);
}

export function createBackgroundDownloadGate() {
  let paused = false;
  const listeners = new Set();
  return {
    setPaused(value) {
      const next = !!value;
      if (paused === next) return;
      paused = next;
      if (!paused) for (const wake of [...listeners]) wake();
    },
    async wait(signal) {
      while (paused && !signal?.aborted) {
        await new Promise(resolve => {
          const wake = () => { listeners.delete(wake); signal?.removeEventListener('abort', wake); resolve(); };
          listeners.add(wake);
          signal?.addEventListener('abort', wake, { once: true });
          if (signal?.aborted || !paused) wake();
        });
      }
      if (signal?.aborted) throw Object.assign(new Error('Image loading stopped'), { name: 'AbortError' });
    },
  };
}

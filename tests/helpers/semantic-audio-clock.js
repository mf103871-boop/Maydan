// Only the semantic audio clock is controlled. React, the socket client and the
// game's visible deadline retain their real browser clocks in integration tests.
export function createSemanticAudioClock(initial = 1000) {
  let time = initial, sequence = 0;
  const timers = new Map();
  const next = limit => [...timers].filter(([, task]) => task.at <= limit)
    .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
  const run = (target, late) => {
    let count = 0, entry;
    while ((entry = next(target))) {
      if (++count > 1000) throw new Error('Semantic audio timer loop');
      timers.delete(entry[0]);
      if (!late) time = Math.max(time, entry[1].at);
      entry[1].callback();
    }
    time = target;
  };
  return {
    now: () => time,
    schedule(callback, delay) {
      const id = ++sequence;
      timers.set(id, {at: time + delay, callback});
      return id;
    },
    cancel: id => timers.delete(id),
    advance: ms => run(time + ms, false),
    // Model a suspended/overloaded event loop without rewinding event age when
    // callbacks eventually run. Expired events must remain silent.
    elapse: ms => {time += ms;},
    flushLate: () => run(time, true),
    pending: () => timers.size,
  };
}

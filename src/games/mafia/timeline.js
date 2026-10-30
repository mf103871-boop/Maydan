// These rows have already passed the server's viewer projection. Never read
// raw roles, private events, other channels or another account's cache here.
export function mafiaTimelineScope(state, ownerId) {
  return JSON.stringify([ownerId || '', state.code || '', state.matchId ?? 'lobby', state.scope || 'player']);
}

const stableId = (kind, row) => `${kind}:${row.id ?? row.clientId ?? JSON.stringify([row.at, row.playerId || row.senderId, row.type, row.text || row.message])}`;
const rows = (kind, values) => (values || []).map(value => ({ kind, key: stableId(kind, value), at: Number(value.at) || 0, value }));

export function mergeMafiaTimeline(previous, { scope, channel, events = [], messages = [] }) {
  const base = previous?.scope === scope ? previous : { scope, events: [], channels: {} };
  const append = (old, incoming) => {
    const known = new Set(old.map(row => row.key));
    const added = incoming.filter(row => { if (known.has(row.key)) return false; known.add(row.key); return true; });
    return added.length ? [...old, ...added] : old;
  };
  const publicRows = append(base.events, rows('event', events));
  const oldMessages = base.channels[channel] || [];
  const messagesForChannel = append(oldMessages, rows('message', messages));
  if (publicRows === base.events && messagesForChannel === oldMessages && base.channels[channel]) return base;
  return { scope, events: publicRows, channels: { ...base.channels, [channel]: messagesForChannel } };
}

export function readMafiaTimeline(cache, channel) {
  return [...cache.events, ...(cache.channels[channel] || [])].sort((a, b) => a.at - b.at || a.key.localeCompare(b.key, 'en', { numeric: true }));
}

// Pagination limits mounted DOM only. Earlier authorized rows remain available.
export function pageMafiaTimeline(rows, count = 40) {
  const start = Math.max(0, rows.length - Math.max(1, count));
  return { rows: rows.slice(start), earlier: start, total: rows.length };
}

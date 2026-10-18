// Identity and placement are shared by the rail and the expanded participant list.
export function callParticipantId(person) {
  for (const value of [person?.userId, person?.identity, person?.id, person?.user?.id]) {
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return '';
}

export function normalizeCallParticipants(participants = [], { currentUserId, muted = false, connected = false, connecting = false, privateTurn = false } = {}) {
  const people = new Map();
  for (const participant of participants) {
    const id = callParticipantId(participant);
    if (!id) continue;
    const local = !!participant.local || (!!currentUserId && id === String(currentUserId));
    const person = { ...participant.user, ...participant, id, userId: id, local };
    person.name = local ? 'أنت' : String(person.name || '').trim() || 'لاعب ميدان';
    person.muted = local ? !!(muted || privateTurn || person.muted) : !!person.muted;
    person.speaking = !!(connected && !connecting && !person.muted && person.speaking);
    // A duplicate identity must never create a second avatar or revive stale speech.
    people.set(id, { ...people.get(id), ...person });
  }
  return [...people.values()];
}

export function stableCallParticipants(previousIds = [], participants = []) {
  const current = new Map(participants.map(person => [callParticipantId(person), person]));
  const ids = [...previousIds.filter(id => current.has(id))];
  const known = new Set(ids);
  for (const id of current.keys()) if (!known.has(id)) { ids.push(id); known.add(id); }
  return ids.map(id => current.get(id));
}

export function selectDockParticipants(participants, capacity = 4, promotedId = null) {
  const count = Math.max(0, Math.min(4, Math.floor(capacity)));
  const visible = participants.slice(0, count);
  const outside = participants.slice(count);
  const promoted = outside.find(person => person.id === promotedId && person.speaking) || outside.find(person => person.speaking);
  if (promoted && visible.length) visible[visible.length - 1] = promoted;
  const shown = new Set(visible.map(person => person.id));
  const hidden = participants.filter(person => !shown.has(person.id));
  return { visible, hidden, hiddenSpeakingCount: hidden.filter(person => person.speaking).length, promotedId: promoted?.id || null };
}

// Three permanent 44px controls, padding/gaps, plus room for a promoted name.
export function dockCapacity(availableHeight, participantCount) {
  const height = Math.max(0, Number(availableHeight) || 0);
  const total = Math.max(0, Math.floor(participantCount) || 0);
  let capacity = Math.min(4, total);
  while (capacity > 1 && 148 + capacity * 46 + (total > capacity ? 46 : 0) + 12 > height) capacity--;
  return capacity;
}

export function clampDockPosition(position, availableHeight, dockHeight) {
  return Math.max(0, Math.min(Number(position) || 0, Math.max(0, (Number(availableHeight) || 0) - (Number(dockHeight) || 0))));
}

// Null X starts on the physical right. Keep the preferred position separately:
// a keyboard or rotation may temporarily reduce the space without losing it.
export function clampFloatingDockPosition(position = {}, bounds = {}) {
  const size = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  const maxX = Math.max(0, size(bounds.width) - size(bounds.dockWidth));
  const maxY = Math.max(0, size(bounds.height) - size(bounds.dockHeight));
  const x = position.x == null || !Number.isFinite(Number(position.x)) ? maxX : Number(position.x);
  const y = Number.isFinite(Number(position.y)) ? Number(position.y) : 0;
  return { x: Math.max(0, Math.min(x, maxX)), y: Math.max(0, Math.min(y, maxY)) };
}

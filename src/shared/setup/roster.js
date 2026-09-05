// دفتر اللاعبين: اسم + إيموجي من مجموعة ثابتة + لون تلقائي من لوحة. حتى 12 لاعبًا.
export const ROSTER_LIMIT = 12;
export const EMOJIS = ['😎', '🦁', '🐼', '🦊', '🐯', '🐸', '🦄', '🐙', '🦋', '🐨', '🐧', '🦉', '🐬', '🦖', '🍉', '🍕', '⚽', '🎸', '🚀', '🎯', '🌟', '🔥', '🧊', '🎲'];
export const COLORS = ['#F5B82E', '#4DA3FF', '#2ED8A3', '#FF5C8A', '#B57BFF', '#FF8A4D', '#38D9F5', '#F5E64D', '#FF4D4D', '#7CE07C', '#F59EDB', '#9DB4FF'];
export const TEAM_COLORS = [
  { id: 'team-1', name: 'الفريق الذهبي', color: '#F5B82E' },
  { id: 'team-2', name: 'الفريق الأزرق', color: '#4DA3FF' },
  { id: 'team-3', name: 'الفريق الأخضر', color: '#2ED8A3' },
  { id: 'team-4', name: 'الفريق الوردي', color: '#FF5C8A' },
];

export function cleanName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 20);
}

export function normalizeName(value) {
  return cleanName(value).toLocaleLowerCase('ar');
}

export function nextColor(roster) {
  const used = new Set(roster.map((p) => p.color));
  return COLORS.find((c) => !used.has(c)) || COLORS[roster.length % COLORS.length];
}

export function nextEmoji(roster) {
  const used = new Set(roster.map((p) => p.emoji));
  return EMOJIS.find((e) => !used.has(e)) || EMOJIS[roster.length % EMOJIS.length];
}

export function makePlayer(roster, name, emoji) {
  return {
    id: `p-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    name: cleanName(name),
    emoji: emoji || nextEmoji(roster),
    color: nextColor(roster),
  };
}

// يعيد { ok, message?, player? }
export function addPlayer(roster, name, emoji) {
  const clean = cleanName(name);
  if (!clean) return { ok: false, message: 'اكتب اسم اللاعب' };
  if (roster.length >= ROSTER_LIMIT) return { ok: false, message: `الحد الأقصى ${ROSTER_LIMIT} لاعبًا` };
  if (roster.some((p) => normalizeName(p.name) === normalizeName(clean))) return { ok: false, message: 'هذا الاسم موجود بالفعل' };
  return { ok: true, player: makePlayer(roster, clean, emoji) };
}

export function validateTeamNames(names) {
  const trimmed = names.map(cleanName);
  if (trimmed.some((n) => !n)) return { ok: false, message: 'اكتب اسمًا لكل فريق' };
  if (new Set(trimmed.map(normalizeName)).size !== trimmed.length) return { ok: false, message: 'يجب أن يكون لكل فريق اسم مختلف' };
  return { ok: true, names: trimmed };
}

export function makeTeams(count, names = []) {
  return TEAM_COLORS.slice(0, count).map((t, i) => ({ id: t.id, name: cleanName(names[i]) || t.name, color: t.color, emoji: ['🥇', '🔵', '🟢', '🩷'][i] }));
}

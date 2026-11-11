// Shared with the original notebook portrait. Keep its saved-player fallback
// code-point based (including emoji sequences), never a game role or faction.
export const AVATAR_OPTIONS = [
  { emoji:'😎', label:'الشخصية بالكنزة الفيروزية', index:0 },
  { emoji:'🦋', label:'الشخصية بالحجاب البنفسجي', index:1 },
  { emoji:'🌟', label:'الشخصية بالنظارة البنفسجية', index:2 },
  { emoji:'🚀', label:'الشخصية بالقبعة الذهبية', index:3 },
];

export function resolveAvatarIndex({ player, emoji, index } = {}) {
  const value = emoji || player?.emoji || '';
  const selected = AVATAR_OPTIONS.find(option=>option.emoji===value);
  const fallback = Array.from(value || player?.id || '0').reduce((sum,char)=>sum+char.codePointAt(0),0)%4;
  return index ?? selected?.index ?? fallback;
}

import { EN } from '../../../shared/i18n/en.js';

const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Only lesson-authored copy reaches this matcher. Dynamic values are fictional
// cast names or faction labels, never learner text or real room messages.
let fragmentCount = -1, fragmentGroups = new Map();
function fragmentsFor(value) {
  if (fragmentCount > 0) return fragmentGroups.get(value[0]) || [];
  const entries = Object.entries(EN);
  if (fragmentCount === entries.length) return fragmentGroups.get(value[0]) || [];
  fragmentCount = entries.length; fragmentGroups = new Map();
  for (const [source, english] of entries.sort(([a], [b]) => b.length - a.length)) {
    if (!/[\u0600-\u06ff]/u.test(source) || typeof english !== 'string') continue;
    const names = [...source.matchAll(/\{(v\d+)\}/g)].map(match => match[1]);
    const pieces = source.split(/\{v\d+\}/g).map(escape);
    const fragment = { source, english, names, pattern: new RegExp('^' + pieces.join('(.+?)')) };
    const group = fragmentGroups.get(source[0]) || [];group.push(fragment);fragmentGroups.set(source[0],group);
  }
  return fragmentGroups.get(value[0]) || [];
}
export function localizeLessonText(value, locale = 'ar') {
  if (locale !== 'en' || typeof value !== 'string') return value;
  let remaining = value, output = '';
  while (remaining) {
    let found = false;
    for (const fragment of fragmentsFor(remaining)) {
      const match = fragment.pattern.exec(remaining);
      if (!match) continue;
      const variables = Object.fromEntries(fragment.names.map((name, index) => [name, localizeLessonText(match[index + 1], locale)]));
      output += fragment.english.replace(/\{(v\d+)\}/g, (whole, name) => variables[name] ?? whole);
      remaining = remaining.slice(match[0].length);found = true;break;
    }
    if (!found) { output += remaining[0]; remaining = remaining.slice(1); }
  }
  return output;
}

// A presentation projection: the engine, journal, IDs and saved checkpoint stay
// byte-for-byte unchanged when the UI language changes midway through a lesson.
export function localizeTutorialView(view, humanId, locale = 'ar', roomTitle) {
  if (locale !== 'en') return view;
  const text = value => localizeLessonText(value, locale), snapshot = view.snapshot;
  const bots = new Set(snapshot.members.filter(member => member.trainingBot).map(member => member.id));
  const coach = view.coach && { ...view.coach, title: text(view.coach.title), text: text(view.coach.text), buttonLabel: text(view.coach.buttonLabel),
    ...(view.coach.choices ? { choices: view.coach.choices.map(choice => ({ ...choice, label: text(choice.label) })) } : {}) };
  return { ...view, coach, feedback: view.feedback && { ...view.feedback, title: text(view.feedback.title), text: text(view.feedback.text) },
    snapshot: { ...snapshot, members: snapshot.members.map(member => ({ ...member, name: text(member.name) })),
      settings: { ...snapshot.settings, roomName: text(roomTitle || snapshot.settings.roomName) },
      chats: Object.fromEntries(Object.entries(snapshot.chats || {}).map(([channel, messages]) => [channel, messages.map(message => {
        const sender = message.senderId || message.playerId;
        return sender !== humanId && bots.has(sender) ? { ...message, text: text(message.text) } : message;
      })])),
      ...(snapshot.replay ? { replay: { ...snapshot.replay, players: snapshot.replay.players.map(player => ({ ...player, name: text(player.name) })) } } : {}),
    } };
}

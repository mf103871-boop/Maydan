import { DESIGN_SCREENS, getScreenDefinition } from './registry.js';
import { initialState as beepInitial } from '../games/beep/logic.js';
import { initialState as mamnooInitial } from '../games/mamnoo/logic.js';
import { initialState as jabeenInitial } from '../games/jabeen/logic.js';
import { initialState as meenInitial } from '../games/meenfina/logic.js';
import { initialState as fabInitial, TRUTH_ID, roundBreakdown } from '../games/fabraka/logic.js';
import { MAFIA_ROLES, MAFIA_TIMERS } from '../online/mafia-shared.js';
import { CATS } from '../data/categories/index.js';

export const DESIGN_SCENES = Object.freeze(DESIGN_SCREENS.map(screen => Object.freeze({
  id: screen.id, screenId: screen.id, label: screen.label, group: screen.group,
  game: screen.game || null, phase: screen.phase || null, mode: screen.mode || null,
  role: screen.role || null, renderer: screen.game && !screen.id.startsWith('online.') && screen.game !== 'ersomha' ? 'local-game' : screen.id.startsWith('online.') || screen.game === 'ersomha' ? 'room' : 'platform',
})));
export function getDesignScene(id) { return DESIGN_SCENES.find(scene => scene.id === id) || null; }
export const DESIGN_FIXTURE_TIME = 1_800_000_000_000;
export const DESIGN_FIXTURE_PLAYERS = Object.freeze([
  { id: 'design-player-1', name: 'ليان', emoji: '🦊', avatar: 0, color: '#087D89' },
  { id: 'design-player-2', name: 'عمر', emoji: '🦁', avatar: 1, color: '#9250BD' },
  { id: 'design-player-3', name: 'سارة', emoji: '🦉', avatar: 2, color: '#B78118' },
  { id: 'design-player-4', name: 'أحمد', emoji: '🚀', avatar: 3, color: '#AE343E' },
]);
const clone = value => JSON.parse(JSON.stringify(value));
export function createDesignFixture(id, { now = DESIGN_FIXTURE_TIME } = {}) {
  const scene = getDesignScene(id);
  if (!scene) throw new Error(`Unknown design scene: ${id}`);
  const players = clone(DESIGN_FIXTURE_PLAYERS);
  const teams = players.slice(0, 2).map((p, index) => ({ ...p, name: index ? 'فريق النجوم' : 'فريق اللمّة' }));
  const question = { id: 'design-question', factId: 'design-fact', text: 'للأخطبوط ___ قلوب.', answer: 'ثلاثة', aliases: ['3'], explanation: 'سؤال توضيحي لعرض تصميم الصفحة.', category: 'الطبيعة', kind: 'text', difficulty: 'medium' };
  const fixture = { scene, players, teams, state: null, me: players[0], _designPreview: true };
  if (scene.game === 'beep') {
    const state = beepInitial(players, { mode: scene.mode, seconds: 7, rounds: 3 }, { random: () => .5 });
    state.phase = scene.phase; state.prompt = { id: 'design-prompt', text: 'سمّ ثلاثة أشياء تأخذها في رحلة', category: 'الحياة اليومية' };
    state.boomPlayerId = players[0].id; state.scores[players[0].id] = 2;
    state.history = []; fixture.state = state;
  } else if (scene.game === 'mamnoo') {
    const state = mamnooInitial(teams, { seconds: 60, rounds: 3 }); state.phase = scene.phase;
    state.card = { id: 'design-card', word: 'المكتبة', category: 'أماكن', forbidden: ['كتاب', 'قراءة', 'رفوف', 'مدرسة', 'استعارة'] };
    state.tally = { correct: 3, buzz: 1, skip: 1 }; state.scores[teams[0].id] = 2; fixture.state = state;
  } else if (scene.game === 'jabeen') {
    const state = jabeenInitial(players, { id: 'animals', name: 'الحيوانات' }, { seconds: 60, control: 'touch' }); state.phase = scene.phase;
    state.item = { id: 'design-item', text: 'زرافة' }; state.results = [{ itemId: 'design-item-1', text: 'دلفين', ok: true }, { itemId: 'design-item-2', text: 'بطريق', ok: false }];
    state.scores[players[0].id] = 3; fixture.state = state;
  } else if (scene.game === 'meenfina' && scene.mode === 'local') {
    const state = meenInitial(players, { mode: ['vote','result'].includes(scene.phase) ? 'secret' : 'point', rounds: 5 }); state.phase = scene.phase;
    state.statement = { id: 'design-statement', text: 'مين فينا يخطط للرحلة قبل الجميع؟', tag: 'سفر' };
    state.votes = Object.fromEntries(players.map(p => [p.id, players[1].id])); state.winners = [players[1].id]; state.scores[players[1].id] = 3; fixture.state = state;
  } else if (scene.game === 'fabraka' && scene.mode === 'local') {
    const state = fabInitial(players, { mode: scene.phase === 'host' ? 'friends' : 'classic', writeSeconds: 45, discussionSeconds: 20 }, { deck: [question], seed: 1, sessionId: 'design-session' });
    state.phase = scene.phase; state.question = question; state.ready = true; state.order = players.map(p => p.id); state.deckCursor = 1; state.remaining = 32;
    if (scene.phase === 'host') { state.hostId = players[0].id; state.order = players.slice(1).map(p => p.id); }
    state.options = [{ id: TRUTH_ID, text: 'ثلاثة', owners: [], earners: [], assisted: [] }, { id: 'design-lie-1', text: 'قلبان', owners: [players[1].id], earners: [players[1].id], assisted: [] }, { id: 'design-lie-2', text: 'خمسة', owners: [players[2].id], earners: [players[2].id], assisted: [] }];
    state.votes = { [players[0].id]: TRUTH_ID, [players[1].id]: TRUTH_ID, [players[2].id]: 'design-lie-1', [players[3].id]: 'design-lie-1' };
    state.revealGroups = [['design-lie-2'], [TRUTH_ID, 'design-lie-1']]; state.revealed = false;
    state.breakdown = roundBreakdown(state); state.roundScores = Object.fromEntries(Object.entries(state.breakdown).map(([key, value]) => [key, value.points]));
    fixture.state = state;
  } else if (scene.game === 'badeeha' && scene.mode !== 'online') {
    const bteams = teams.map(t => ({ ...t, score: t.id === teams[0].id ? 600 : 400, correct: 2, steals: 0, tools: { double: true, two: true, switch: true } }));
    const record = { id: 'design-result', teams: bteams, winner: bteams[0].name, answered: 8, total: 12, mode: 'expert', date: now, at: now, early: false };
    fixture.badeeha = { screen: scene.phase, teams: bteams, selectedCategories: ['general'], current: { categoryId: 'general', index: 0 }, deck: { general: [{ qid: 'design-badeeha', p: 600, q: 'أي حيوان بحري له ثلاثة قلوب؟', a: 'الأخطبوط', alt: [], type: 'text' }] }, finalResult: record, results: [record], revealed: false };
  }
  if (scene.id.startsWith('online.') || scene.game === 'ersomha') {
    const members = players.map((p, i) => ({ ...p, ready: true, connected: true, left: false, score: i ? 100 : 250, stats: { truths: 1, fooled: 2, laughs: 1 }, profile: { avatarPreset: ['fox','lion','owl','rocket'][i], theme: 'teal' } }));
    const game = scene.game || (scene.id === 'online.lobby' ? 'ersomha' : 'meenfina');
    const options = [{ id: TRUTH_ID, text: 'ثلاثة', truth: true, mine: false, owners: [], earners: [], voters: [players[0].id], funnyVoters: [], fooled: 0 }, { id: 'design-choice-1', text: 'قلبان', truth: false, mine: false, owners: [players[1].id], earners: [players[1].id], voters: [players[2].id], funnyVoters: [], fooled: 1 }, { id: 'design-choice-2', text: 'خمسة', truth: false, mine: false, owners: [players[2].id], earners: [players[2].id], voters: [], funnyVoters: [], fooled: 0 }];
    const state = { _designPreview: true, game, phase: scene.phase || 'lobby', code: '123456', matchId: 1, hostId: players[0].id, members, participants: players.map(p => p.id), round: 1, rounds: 4, settings: { mode: 'classic', cycles: 1, difficulty: 'medium', categories: [], drawSeconds: 60, writeSeconds: 45, discussionSeconds: 20, funnyVote: true, finalDouble: false }, deadlineAt: now + 45_000, reason: null, question: game === 'meenfina' ? { text: 'مين فينا يخطط للرحلة قبل الجميع؟' } : question, myVote: { submitted: false }, submittedCount: 1, winners: [players[1].id], counts: Object.fromEntries(players.map(p => [p.id, p.id === players[1].id ? 3 : 0])), history: [], options, writingCount: 1, writerCount: 4, mySubmission: { submitted: false }, helpAvailable: true, myHelp: '', truthHostId: scene.phase === 'host' ? players[0].id : null, reveal: { final: false, shown: true, options }, breakdown: Object.fromEntries(players.map(p => [p.id, { truth: 1, fooled: 0, laughs: 0, points: 1000 }])), scores: Object.fromEntries(players.map(p => [p.id, p.id === players[0].id ? 250 : 100])) };

    if (game === 'mafia') {
      state.settings = { mode:'shadow',capacity:10,visibility:'private' }; state.phaseId = 4; state.serverNow=now; state.deadlineAt = MAFIA_TIMERS[scene.phase] ? now + (scene.phase==='discussion' ? MAFIA_TIMERS.shadowDiscussion : MAFIA_TIMERS[scene.phase])*1000 : null;
      state.members = Array.from({length:10},(_,i)=>({...members[i%4],id:`design-player-${i+1}`,name:['ليان','عمر','سارة','أحمد','نور','زين','لينا','وسام','هند','سامي'][i],seat:i+1,alive:i!==8,score:undefined}));
      fixture.me=state.members[0];state.participants=state.members.map(p=>p.id);state.possibleRoles=Object.keys(MAFIA_ROLES);state.composition={town:7,mafia:2,shadow:1};
      const role=MAFIA_ROLES[scene.role] || MAFIA_ROLES.investigator;
      state.you={id:fixture.me.id,roleId:role.id,faction:role.faction,alive:true,allies:role.faction==='mafia'?['design-player-2']:[],resources:{charges:role.charges,selfProtection:role.id==='doctor'?1:0,shield:role.id==='guard'?1:0},reports:[{id:1,type:'investigation',round:1,targetId:'design-player-2',faction:'town'}],actions:[],nightAction:null,killTarget:null,nominationSubmitted:false,verdictSubmitted:false};
      const targets=state.members.filter(p=>p.id!==fixture.me.id&&p.alive).map(p=>p.id);
      if(state.phase==='night') {
        if(!['citizen','guard','herald','mafia'].includes(role.id)) state.you.actions.push({type:'night_action',targets:role.id==='reporter'?['design-player-9']:targets,count:role.id==='analyst'?2:1,remaining:role.charges});
        if(role.faction==='mafia') state.you.actions.push({type:'mafia_vote',targets:targets.filter(id=>id!=='design-player-2')});
      }
      if(state.phase==='nomination') state.you.actions.push({type:'nominate',targets:state.members.filter(p=>p.alive).map(p=>p.id)});
      if(state.phase==='verdict') state.you.actions.push({type:'verdict',targets:[]});
      state.nomineeId='design-player-2';state.chats={public:[{id:1,playerId:'design-player-2',text:'خلينا نراجع رواية الليلة الماضية.',at:now}],team:[],observers:[]};
      state.log=[{id:1,type:'match_started',at:now,round:1},{id:2,type:'dawn',peaceful:true,at:now,round:1}];
      state.previewScene=scene.id;state.previewReveal=scene.phase==='role';state.previewTab=['clues','notes'].includes(scene.role)?scene.role:'council';
      // The private modal owns its semantic root; the surrounding council keeps
      // its public phase identity, just as it does during a real card reveal.
      if(scene.id==='online.mafia.role-card')state.previewScene='online.mafia.role';
      if(scene.phase==='waiting'){state.waiting=true;delete state.you;state.chats={};state.log=[];state.deadlineAt=null;}
      if(['over','closed'].includes(scene.phase)){state.deadlineAt=null;state.outcome={faction:scene.phase==='closed'?'draw':'town'};state.replay={players:state.members.map((p,i)=>({playerId:p.id,roleId:i===0?'investigator':i===1?'mafia':'citizen',faction:i===1?'mafia':'town'})),events:state.log};}
    }
    if (game === 'badeeha') {
      const clueCategory = CATS.find(category => category.qs.some(q => q.type === 'hints' && q.p === 600));
      const clue = clueCategory.qs.find(q => q.type === 'hints' && q.p === 600);
      const selected = [clueCategory, ...CATS.filter(category => category.id !== clueCategory.id).slice(0, 5)];
      const deck = Object.fromEntries(selected.map((category, index) => [category.id, category.qs.filter(q => q.p <= 800).slice(0, index < 2 ? 4 : 3).map(q => ({ qid: q.qid, p: q.p }))]));
      deck[clueCategory.id][0] = { qid: clue.qid, p: clue.p };
      state.settings = { mode: 'standard', roundSize: 20, timer: 60, categories: selected.map(category => category.id), deck };
      state.rounds = 20; state.turnId = members[0].id;
      state.teams = members.map(m => ({ id: m.id, score: m.score, correct: 1, steals: 0, tools: { double: true, two: true, time: true } }));
      state.used = []; state.hintsUsed = 0; state.effect = { double: false, two: false }; state.verdict = null; state.canUndo = true;
      state.current = ['question','reveal'].includes(state.phase) ? { categoryId: clueCategory.id, index: 0, qid: clue.qid, p: clue.p } : null;
      state.deadlineAt = state.phase === 'question' ? now + 45_000 : null;
      fixture.me = members[0];
    } else if (game === 'ersomha') {
      if (scene.id === 'ersomha.private-wait') state.phase = 'select';
      state.settings.mode = 'competitive'; state.drawerId = players[0].id; state.drawing = { epoch: 1, seq: 0 };
      state.myChoices = scene.role === 'drawer' ? [{ id: 'demo-choice-1', text: 'قطار', category: 'transport' }, { id: 'demo-choice-2', text: 'حديقة', category: 'nature' }, { id: 'demo-choice-3', text: 'مكتبة', category: 'places' }] : undefined;
      state.myWord = scene.role === 'drawer' ? 'قطار' : undefined; state.revealedWord = state.phase === 'result' ? 'قطار' : undefined;
      state.category = 'transport'; state.publicWord = { category: 'transport', wordLengths: [4], letters: [] }; state.guessedIds = [players[2].id]; state.recentGuesses = [{ id: 'demo-guess', playerId: players[2].id, correct: true }];
      state.cooperative = { solvedTurns: 3, remainingMs: 43000 }; fixture.me = scene.role === 'guesser' ? members[1] : members[0];
    } else if(game !== 'mafia') fixture.me = members[0];
    fixture.state = state;
  }
  if (fixture.state) fixture.state._designPreview = true;
  fixture.profile = { id: players[0].id, name: players[0].name, code: 'MDN123', bio: 'ألعاب ولمّة وسوالف، كل جمعة لها ميدان.', avatarPreset: 'fox', theme: 'teal', relationship: 'self', revision: 1, friendCount: 4, stats: { localSessions: 12, onlineMatches: 8, onlineWins: 3, distinctGames: 7 }, earnedBadges: ['welcome','identity','first-friend'], earnedTitles: ['member','distinctive','companion'], selectedTitle: 'member', featuredBadges: ['welcome','first-friend'], achievements: [], imageReviews: {} };
  return fixture;
}

// Used by coverage checks and the studio tree; never reads private account data.
export function designSceneNodes(id) { return getScreenDefinition(id)?.nodes || []; }

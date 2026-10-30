// Imported only by the build-gated LOCAL preview renderer. These explicit
// display fixtures are not real rooms, balance tests, or a network simulation.
const NAMES = ['أنت · عرض','ليان · عرض','عمر · عرض','سليم · عرض','نور · عرض','مازن · عرض','هلا · عرض','لينا · عرض','رامي · عرض','ياسمين · عرض','كريم · عرض','سارة · عرض'];
const KINDS = { discussion:['discussion','النقاش مستمر','dawn'],night:['night','حلّ الليل','night'],dawn:['dawn','أشرقت الشمس','dawn'],defense:['defense','استمع إلى الدفاع','verdict'],nomination:['nomination','حان الترشيح','verdict'],elimination:['dawn','خبر من الليل','elimination'],reveal:['discussion','دليل معلن للمجلس','deal'],ending:['over','انكشفت الحكاية','ending'] };

export function createMafiaVisualFixture(kind = 'discussion', { now = Date.now() } = {}) {
  if (!Object.hasOwn(KINDS,kind)) throw new Error('Unknown local Mafia display fixture');
  const [phase,title,scene] = KINDS[kind];
  const members = NAMES.map((name,i)=>({id:`local-display-${i+1}`,name,avatar:i%8,seat:i+1,ready:true,connected:true,alive:kind==='elimination'?i!==2:kind==='ending'?![3,4,5,6].includes(i):true,joinedAt:now-100_000}));
  const me = members[0], targets = members.filter(player=>player.alive&&player.id!==me.id).map(player=>player.id);
  const log = [{id:1,type:'match_started',at:now-95_000,round:1},{id:2,type:'night_started',at:now-40_000,round:1},{id:3,type:'dawn',at:now-5000,round:1,peaceful:kind!=='elimination'}];
  if(kind==='elimination')log.push({id:4,type:'eliminated',playerId:members[2].id,reason:'night',at:now,round:1});
  if(kind==='reveal')log.push({id:4,type:'faction_revealed',targetId:members[2].id,faction:'town',at:now,round:1});
  if(kind==='ending')log.push({id:4,type:'match_ended',at:now,round:2});
  const state = {game:'mafia',protocol:2,rulesetVersion:1,code:'LOCAL_DISPLAY_ONLY',matchId:101,phaseId:10,phase,round:1,serverNow:now,deadlineAt:phase==='over'?null:now+(phase==='defense'?20:phase==='night'?35:90)*1000,hostId:me.id,members,scope:'player',settings:{mode:'shadow',capacity:12,visibility:'private',voiceMode:'optional',roomName:'حالة عرض محلية'},log,chats:{public:Array.from({length:18},(_,i)=>({id:`public:${i+1}`,playerId:members[i%members.length].id,text:['خلّينا نسمع التفاصيل قبل ما نحكم.','شو المعلومة اللي بنبني عليها؟','الدليل يخص الليلة الماضية؛ خلّينا نتأكد.'][i%3],at:now-3000+i*100})),team:[],observers:[]},you:{id:me.id,roleId:'investigator',faction:'town',alive:true,resources:{charges:2},actions:phase==='night'?[{type:'night_action',targets,count:1,remaining:2}]:phase==='nomination'?[{type:'nominate',targets:[me.id,...targets],count:1,remaining:1}]:[],reports:[],allies:[],voice:{canListen:phase!=='night',canSpeak:phase!=='night'&&(phase!=='defense'||me.id===members[1].id)}},mafiaVoice:{mediaEpoch:1,quiet:phase==='night',outage:false},nomineeId:phase==='defense'?members[1].id:null};
  if(kind==='ending') {
    state.reason='faction';state.outcome={faction:'town'};
    const roles=['investigator','doctor','citizen','mafia','masker','blocker','leader','analyst','guard','herald','citizen','citizen'];
    state.replay={players:members.map((player,i)=>({playerId:player.id,roleId:roles[i],initialFaction:i>=3&&i<=5?'mafia':i===6?'shadow':'town',faction:i>=3&&i<=5?'mafia':i===6?'shadow':'town'})),events:[log.at(-1)]};
  }
  return {state,me,effect:{id:`local-demo:${kind}:${now}`,kind:kind==='elimination'?'assassination':kind,title,scene,caption:'حالة عرض محلية · جميع الأسماء والنتائج افتراضية',durationMs:1600}};
}

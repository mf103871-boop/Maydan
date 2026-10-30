// Imported only by the compile-time + loopback gated main entry. No production route.
import React, { useEffect, useMemo, useState } from 'react';
import { PlatformProviders } from '../platform/PlatformApp.jsx';
import { ToastProvider } from '../shared/ui/components.jsx';
import { usePlatform } from '../platform/context.js';
import { BrandFonts } from '../shared/brand/art.jsx';
import { ProfileAvatar } from '../profiles/ProfileAvatar.jsx';
import { MafiaMatchView, MafiaEventOverlay } from '../online/Mafia.jsx';
import { OnlineDirectoryView, OnlineRoomRow } from '../online/OnlineDirectoryView.jsx';
import { createMafiaVisualFixture } from '../games/mafia/preview-fixtures.js';
import uiCss from '../shared/ui/ui.css';
import setupCss from '../shared/setup/setup.css';
import platformCss from '../platform/platform.css';
import brandCss from '../shared/brand/brand.css';
import onlineCss from '../online/online.css';

const names = { mafia: 'مافيا ميدان', badeeha: 'بَديهة', ersomha: 'ارسمها', fabraka: 'فبركة', meenfina: 'مين فينا؟' };
const styles = `.local-review-scene{height:100dvh;min-height:0;display:flex;flex-direction:column;overflow:visible;background:var(--bg,#fff8ea)}.local-scene-note{flex:none;display:flex;align-items:center;justify-content:space-between;gap:8px;background:#e9def6;color:#422350;min-height:38px;padding:3px 9px;font:11px system-ui}.local-scene-note button{border:1px solid #a98bbd;background:#fff8ed;border-radius:7px;min-height:30px;padding:3px 8px;color:#482953}.local-scene-body{flex:1;min-height:0;position:relative;display:flex;flex-direction:column;--mafia-viewport-height:calc(100dvh - 38px)}.local-scene-body>.online-directory{height:100%;min-height:0}.local-scene-footer{display:flex;align-items:center;gap:12px;padding:10px 14px;background:#fff6e5;color:#392442}.local-scene-footer small{display:block}.local-scene-status{position:fixed;inset-inline:10px;bottom:12px;background:#fff1d9;padding:10px;border:1px solid #cdb89c;border-radius:12px;z-index:5000;font:12px system-ui}`;

function DirectoryScene({ game }) {
  const [note, setNote] = useState('');
  const rooms = useMemo(() => Array.from({ length: 32 }, (_, i) => {
    const capacity = game === 'badeeha' ? 4 : 8, status = i % 5 === 0 ? 'playing' : i % 7 === 0 ? 'full' : 'waiting';
    return { code: String(300000 + i), name: ['سهرة الأصحاب', 'مجلس الاستنتاج', 'جمعة العيلة', 'لعب وتحدّي'][i % 4] + ' · عرض', status, players: status === 'waiting' ? 1 + i % (capacity - 1) : capacity, capacity, full: status !== 'waiting', voiceMode: i % 3 === 0 ? 'off' : 'optional' };
  }), [game]);
  const explain = () => setNote('هذه صفوف عرض مصطنعة. لإنشاء غرفة واتصال حقيقيين محليًا، اختر دليل اللعبة من «الواجهة الفعلية» في لوحة المراجعة.');
  return <><OnlineDirectoryView game={game} title={names[game]} rooms={rooms} loading={false} error="" enabled onCreate={explain} onCode={explain} onRefresh={explain}
    notice="حالة عرض محلية · ٣٢ صفًا مصطنعًا لفحص التمرير والكثافة" help={<p>حالة بصرية فقط، لا تختبر الاتصال أو السعة.</p>}
    footer={<div className="local-scene-footer"><ProfileAvatar user={{ avatarPreset: 'avatar-0' }} size={48}/><div><strong>ليان · عرض</strong><small>بروفايل افتراضي · دون رتبة أو عملات مخترعة</small></div></div>}
    renderRoom={room => <OnlineRoomRow key={room.code} room={room} title={room.name} subtitle={game === 'badeeha' ? 'فرق · بيانات عرض' : 'لاعبون · بيانات عرض'} statusLabel={room.status === 'playing' ? 'جارية' : room.status === 'full' ? 'ممتلئة' : 'انتظار'} voiceLabel={game === 'mafia' ? room.voiceMode === 'off' ? 'نصية' : 'صوتية · عرض' : undefined} canJoin={room.status === 'waiting'} canObserve={game === 'mafia' && room.status === 'playing'} onJoin={explain} onObserve={explain}/>}/>
    {note && <button className="local-scene-status" onClick={() => setNote('')}>{note} · إغلاق</button>}</>;
}

function MafiaScene({ kind }) {
  const { sound } = usePlatform(), initial = useMemo(() => createMafiaVisualFixture(kind), [kind]);
  const [state, setState] = useState(initial.state), [effect, setEffect] = useState(null), [message, setMessage] = useState('');
  useEffect(() => { setState(initial.state); setEffect(initial.effect); }, [initial]);
  useEffect(() => { if (!effect) return undefined; const timer = setTimeout(() => setEffect(null), effect.durationMs); return () => clearTimeout(timer); }, [effect]);
  useEffect(() => { const replay = () => {
    setEffect({ ...initial.effect, id: `manual-preview:${Date.now()}` });
    const cue = { night: 'mafiaNight', dawn: 'mafiaDawn', elimination: 'mafiaVerdict', ending: 'mafiaFinal' }[kind] || 'mafiaSelect';
    sound?.play?.(cue, { source: 'local-ui-review' });
  }; window.addEventListener('maydan-local-preview-replay', replay); return () => window.removeEventListener('maydan-local-preview-replay', replay); }, [initial, kind, sound]);
  const act = async (type, payload = {}) => {
    if (type === 'chat') { setState(old => ({ ...old, chats: { ...old.chats, public: [...old.chats.public, { id: `local:${Date.now()}`, playerId: initial.me.id, text: payload.text, at: Date.now(), channel: 'public' }] } })); return true; }
    setMessage('إجراء عرض محلي فقط؛ لا يغيّر قواعد مباراة ولا يرسل طلبًا للخادم.'); return true;
  };
  return <><MafiaMatchView state={state} me={initial.me} isHost accountId="local-display-only" act={act} clockOffset={0} sound={sound} connection="connected" voice={{ simulated: true, status: 'idle', participants: [], canSpeak: false }}/><div className="mafia-noir" style={{display:'contents'}}><MafiaEventOverlay effect={effect}/></div>{message && <button className="local-scene-status" onClick={() => setMessage('')}>{message} · إغلاق</button>}</>;
}
function Scene() {
  const params = new URLSearchParams(location.search), kind = params.get('kind') || 'discussion';
  const game = Object.hasOwn(names, params.get('game')) ? params.get('game') : 'mafia';
  return <div className="local-review-scene" dir="rtl"><BrandFonts/><style>{uiCss}{setupCss}{platformCss}{brandCss}{onlineCss}{styles}</style><div className="local-scene-note"><span>عرض محلي · بيانات مصطنعة · لا اتصال صوتي حقيقي</span><button onClick={() => window.dispatchEvent(new Event('maydan-local-preview-replay'))}>إعادة المؤثر</button></div><div className="local-scene-body">{kind === 'directory' ? <DirectoryScene game={game}/> : <MafiaScene kind={kind}/>}</div></div>;
}
export function LocalUIScenes() { return <ToastProvider><PlatformProviders><Scene/></PlatformProviders></ToastProvider>; }

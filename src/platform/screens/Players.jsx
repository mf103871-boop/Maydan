import { Avatar, AvatarPicker, ClayStage } from '../../shared/brand/art.jsx';
// دفتر اللاعبين: إضافة وحذف حتى 12 لاعبًا يُعاد استخدامهم في كل الألعاب الفردية.
import React, { useState, useRef, useEffect } from 'react';
import { Screen, TopBar, IconButton, Button, Card, Modal } from '../../shared/ui/components.jsx';
import { IconBack, IconTrash, IconPlus } from '../../shared/ui/icons.jsx';
import { addPlayer, ROSTER_LIMIT } from '../../shared/setup/roster.js';
import { wait } from '../../shared/fx/index.js';
import { usePlatform } from '../context.js';
import { back, getDirection } from '../router.js';

export function Players() {
  const { roster, setRoster, sound, toast } = usePlatform();
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(null);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState(null);
  // الصف المحذوف يخرج (is-leaving) ثم يُحذف من الدفتر بعد 220ms (صفر تحت تقليل الحركة)؛ الدفتر الأحدث عبر مرجع.
  const [leavingId, setLeavingId] = useState(null);
  const rosterRef = useRef(roster);
  const leaveTimer = useRef(0);
  useEffect(() => { rosterRef.current = roster; }, [roster]);
  const pendingRemove = useRef(null);
  // مغادرة الشاشة أو حذف ثانٍ قبل انقضاء المهلة ينفّذ الحذف المعلّق بدل إلغائه.
  useEffect(() => () => { clearTimeout(leaveTimer.current); if (pendingRemove.current) pendingRemove.current(); }, []);
  const add = () => {
    const r = addPlayer(roster, name, emoji);
    if (!r.ok) { setError(r.message); return; }
    setRoster([...roster, r.player]);
    setName(''); setEmoji(null); setError('');
    sound.play('pop');
  };
  const remove = (player) => {
    setRemoving(null);
    setLeavingId(player.id);
    clearTimeout(leaveTimer.current);
    if (pendingRemove.current) pendingRemove.current();
    const commit = () => {
      pendingRemove.current = null;
      const next = rosterRef.current.filter((p) => p.id !== player.id);
      rosterRef.current = next;
      setRoster(next);
      setLeavingId(null);
      toast(`حُذف ${player.name}`);
      // التركيز يتبع القائمة بدل السقوط إلى body بعد زوال زر الحذف.
      requestAnimationFrame(() => { const el = document.querySelector('.score-row button') || document.querySelector('.screen input.input'); if (el) el.focus(); });
    };
    pendingRemove.current = commit;
    leaveTimer.current = setTimeout(commit, wait(220));
  };
  return (
    <Screen dir={getDirection()} className="stack" aria-label="دفتر اللاعبين">
      <TopBar title="دفتر اللاعبين" eyebrow={`${roster.length} من ${ROSTER_LIMIT}`} start={<IconButton label="رجوع" onClick={back}><IconBack /></IconButton>} />
      <Card className="stack">
        <label className="field"><span>اسم اللاعب</span>
          <input className="input" value={name} maxLength={20} placeholder="مثال: سارة" onChange={(e) => { setName(e.target.value); setError(''); }} onKeyDown={(e) => e.key === 'Enter' && add()} />
        </label>
        <div className="field"><span>شخصيتك (اختياري)</span>
          <AvatarPicker value={emoji} onChange={setEmoji} />
        </div>
        {error && <p className="setup-error" role="alert">{error}</p>}
        <Button variant="primary" size="lg" full icon={<IconPlus />} onClick={add} disabled={roster.length >= ROSTER_LIMIT}>إضافة</Button>
      </Card>
      <div className="scoreboard">
        {roster.map((p) => (
          <div key={p.id} className={`score-row ${leavingId === p.id ? 'is-leaving' : ''}`} style={{ '--row-color': p.color }}>
            <ClayStage className="clay-static no-contact"><Avatar player={p} className="avatar" /></ClayStage>
            <span className="name">{p.name}</span>
            <IconButton label={`حذف ${p.name}`} onClick={() => setRemoving(p)}><IconTrash /></IconButton>
          </div>
        ))}
        {roster.length === 0 && (
          <>
            {/* الحالة الفارغة: أربع شخصيات تهبط وتطفو بتدرّج (حلقة الشاشة الوحيدة) */}
            <div className="roster-empty" aria-hidden="true">{[0, 1, 2, 3].map((i) => <ClayStage key={i} style={{ '--i': i }}><Avatar index={i} /></ClayStage>)}</div>
            <p className="muted center">لا لاعبين بعد. أضف أول لاعب من الأعلى.</p>
          </>
        )}
      </div>
      {removing && (
        <Modal title={`حذف ${removing.name}؟`} onClose={() => setRemoving(null)} footer={<>
          <Button variant="danger" size="lg" full onClick={() => remove(removing)}>حذف</Button>
          <Button variant="ghost" full onClick={() => setRemoving(null)}>إلغاء</Button>
        </>}>
          <p className="muted">يُحذف من الدفتر فقط؛ نتائج الألعاب السابقة لا تتأثر.</p>
        </Modal>
      )}
    </Screen>
  );
}

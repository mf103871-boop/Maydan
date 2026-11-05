import { Avatar, AvatarPicker, ClayStage } from '../../shared/brand/art.jsx';
// دفتر اللاعبين: إضافة وحذف حتى 12 لاعبًا يُعاد استخدامهم في كل الألعاب الفردية.
import React, { useState, useRef, useEffect } from 'react';
import { Screen, TopBar, IconButton, Button, Modal } from '../../shared/ui/components.jsx';
import { IconBack, IconTrash, IconPlus, IconUsers } from '../../shared/ui/icons.jsx';
import { addPlayer, ROSTER_LIMIT } from '../../shared/setup/roster.js';
import { wait } from '../../shared/fx/index.js';
import { usePlatform } from '../context.js';
import { back, getDirection, navigate } from '../router.js';
import { useSubmitKey } from '../../shared/ui/useSubmitKey.js';
import styles from './players-rebuild.css';

export function Players() {
  const { roster, setRoster, sound, toast } = usePlatform();
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(null);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState(null);
  const [editor, setEditor] = useState(null);
  // الصف المحذوف يخرج (is-leaving) ثم يُحذف من الدفتر بعد 220ms (صفر تحت تقليل الحركة)؛ الدفتر الأحدث عبر مرجع.
  const [leavingId, setLeavingId] = useState(null);
  const rosterRef = useRef(roster);
  const leaveTimer = useRef(0);
  useEffect(() => { rosterRef.current = roster; }, [roster]);
  const pendingRemove = useRef(null);
  // مغادرة الشاشة أو حذف ثانٍ قبل انقضاء المهلة ينفّذ الحذف المعلّق بدل إلغائه.
  useEffect(() => () => { clearTimeout(leaveTimer.current); if (pendingRemove.current) pendingRemove.current(); }, []);
  const openEditor = (player = null) => {
    setName(player?.name || ''); setEmoji(player?.emoji || null); setError('');
    setEditor({ id: player?.id || null });
  };
  const save = () => {
    const current = rosterRef.current;
    const editing = editor?.id ? current.find(player => player.id === editor.id) : null;
    if (editor?.id && !editing) { setEditor(null); return; }
    const r = addPlayer(editing ? current.filter(player => player.id !== editing.id) : current, name, emoji);
    if (!r.ok) { setError(r.message); return; }
    const next = editing
      ? current.map(player => player.id === editing.id ? { ...player, name: r.player.name, emoji: r.player.emoji } : player)
      : [...current, r.player];
    rosterRef.current = next;
    setRoster(next);
    setEditor(null);
    sound.play('pop');
  };
  const submitKeys = useSubmitKey(save);
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
      requestAnimationFrame(() => document.querySelector('.players-screen .score-row button, .players-screen [data-design-id="add-player"]')?.focus());
    };
    pendingRemove.current = commit;
    leaveTimer.current = setTimeout(commit, wait(220));
  };
  return (
    <Screen data-design-screen="players" dir={getDirection()} className="stack players-screen" aria-label="دفتر اللاعبين">
      <style>{styles}</style>
      <TopBar data-design-id="topbar" title="دفتر اللاعبين" eyebrow={`${roster.length} من ${ROSTER_LIMIT}`} start={<IconButton data-design-id="back" label="رجوع" onClick={back}><IconBack /></IconButton>} />
      <nav className="players-kind" aria-label="قوائم اللاعبين"><span aria-current="page">لاعبون محليون</span><Button data-design-id="friends" variant="ghost" icon={<IconUsers />} onClick={() => navigate('/friends')}>أصدقاء أونلاين</Button></nav>
      <div data-design-id="players" className="scoreboard">
        {roster.map((p) => (
          <div key={p.id} data-design-id="player-row" className={`score-row ${leavingId === p.id ? 'is-leaving' : ''}`} style={{ '--row-color': p.color }}>
            <ClayStage className="clay-static no-contact"><Avatar player={p} className="avatar" /></ClayStage>
            <span className="name">{p.name}</span>
            <IconButton data-design-id="player-edit" label={`تعديل ${p.name}`} onClick={() => openEditor(p)}><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d="m14 5 5 5m-14 9 1-5L16 4a2 2 0 0 1 3 0l1 1a2 2 0 0 1 0 3L10 18Z"/></svg></IconButton>
            <IconButton data-design-id="player-remove" label={`حذف ${p.name}`} onClick={() => setRemoving(p)}><IconTrash /></IconButton>
          </div>
        ))}
        {roster.length === 0 && (
          <>
            {/* الحالة الفارغة: أربع شخصيات تهبط وتطفو بتدرّج (حلقة الشاشة الوحيدة) */}
            <div className="roster-empty" aria-hidden="true">{[0, 1, 2, 3].map((i) => <ClayStage key={i} style={{ '--i': i }}><Avatar index={i} /></ClayStage>)}</div>
            <p className="muted center">لا لاعبين بعد. أضف أول لاعب للعب على هذا الجهاز.</p>
          </>
        )}
      </div>
      <Button data-design-id="add-player" variant="accent" size="lg" full icon={<IconPlus />} onClick={() => openEditor()} disabled={roster.length >= ROSTER_LIMIT}>إضافة لاعب</Button>
      {editor && (
        <Modal title={editor.id ? 'تعديل اللاعب' : 'إضافة لاعب'} onClose={() => setEditor(null)} footer={<>
          <Button data-design-id="save" variant="accent" full onClick={save}>{editor.id ? 'حفظ التعديلات' : 'إضافة'}</Button>
          <Button data-design-id="cancel" variant="ghost" full onClick={() => setEditor(null)}>إلغاء</Button>
        </>}>
          <label className="field"><span>اسم اللاعب</span>
            <input data-design-id="name-input" className="input" value={name} maxLength={20} placeholder="مثال: سارة" onChange={(e) => { setName(e.target.value); setError(''); }} {...submitKeys} />
          </label>
          <div className="field"><span>الشخصية (اختياري)</span><AvatarPicker data-design-id="avatar-picker" value={emoji} onChange={setEmoji} /></div>
          {error && <p className="setup-error" role="alert">{error}</p>}
        </Modal>
      )}
      {removing && (
        <Modal title={`حذف ${removing.name}؟`} onClose={() => setRemoving(null)} footer={<>
          <Button data-design-id="confirm" variant="danger" size="lg" full onClick={() => remove(removing)}>حذف</Button>
          <Button data-design-id="cancel" variant="ghost" full onClick={() => setRemoving(null)}>إلغاء</Button>
        </>}>
          <p className="muted">يُحذف من الدفتر فقط؛ نتائج الألعاب السابقة لا تتأثر.</p>
        </Modal>
      )}
    </Screen>
  );
}

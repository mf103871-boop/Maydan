import { Avatar, AvatarPicker } from '../../shared/brand/art.jsx';
// دفتر اللاعبين: إضافة وحذف حتى 12 لاعبًا يُعاد استخدامهم في كل الألعاب الفردية.
import React, { useState } from 'react';
import { Screen, TopBar, IconButton, Button, Card, Modal } from '../../shared/ui/components.jsx';
import { IconBack, IconTrash, IconPlus } from '../../shared/ui/icons.jsx';
import { addPlayer, ROSTER_LIMIT } from '../../shared/setup/roster.js';
import { usePlatform } from '../context.js';
import { back, getDirection } from '../router.js';

export function Players() {
  const { roster, setRoster, sound, toast } = usePlatform();
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(null);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState(null);
  const add = () => {
    const r = addPlayer(roster, name, emoji);
    if (!r.ok) { setError(r.message); return; }
    setRoster([...roster, r.player]);
    setName(''); setEmoji(null); setError('');
    sound.play('pop');
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
          <div key={p.id} className="score-row" style={{ '--row-color': p.color }}>
            <Avatar player={p} className="avatar" />
            <span className="name">{p.name}</span>
            <IconButton label={`حذف ${p.name}`} onClick={() => setRemoving(p)}><IconTrash /></IconButton>
          </div>
        ))}
        {roster.length === 0 && <p className="muted center">لا لاعبين بعد. أضف أول لاعب من الأعلى.</p>}
      </div>
      {removing && (
        <Modal title={`حذف ${removing.name}؟`} onClose={() => setRemoving(null)} footer={<>
          <Button variant="danger" size="lg" full onClick={() => { setRoster(roster.filter((p) => p.id !== removing.id)); toast(`حُذف ${removing.name}`); setRemoving(null); }}>حذف</Button>
          <Button variant="ghost" full onClick={() => setRemoving(null)}>إلغاء</Button>
        </>}>
          <p className="muted">يُحذف من الدفتر فقط؛ نتائج الألعاب السابقة لا تتأثر.</p>
        </Modal>
      )}
    </Screen>
  );
}

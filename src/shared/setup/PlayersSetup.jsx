// اختيار اللاعبين من دفتر اللاعبين (أو إضافة لاعب سريع)، بترتيب الاختيار.
import React, { useState } from 'react';
import { Button, Card, Modal } from '../ui/components.jsx';
import { IconPlus } from '../ui/icons.jsx';
import { addPlayer, EMOJIS, ROSTER_LIMIT } from './roster.js';

export function PlayersSetup({ roster, setRoster, min = 2, max = 10, accent, onStart, children, startLabel = 'ابدأ اللعب', startDisabled = false, api }) {
  const [selected, setSelected] = useState(() => roster.slice(0, Math.min(max, roster.length)).map((p) => p.id));
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(null);
  const [error, setError] = useState('');

  const toggle = (id) => {
    setError('');
    api && api.sound.play('click');
    setSelected((list) => (list.includes(id) ? list.filter((x) => x !== id) : list.length < max ? [...list, id] : list));
  };
  const submitAdd = () => {
    const result = addPlayer(roster, name, emoji);
    if (!result.ok) { setError(result.message); return; }
    const next = [...roster, result.player];
    setRoster(next);
    if (selected.length < max) setSelected((list) => [...list, result.player.id]);
    setName(''); setEmoji(null); setAdding(false); setError('');
    api && api.sound.play('pop');
  };
  const players = selected.map((id) => roster.find((p) => p.id === id)).filter(Boolean);
  const canStart = players.length >= min && !startDisabled;

  return (
    <div className="stack">
      <Card>
        <div className="row-between" style={{ marginBottom: 10 }}>
          <span className="card-title">اللاعبون</span>
          <span className="badge">{players.length}/{max}</span>
        </div>
        <div className="chips">
          {roster.map((p) => {
            const order = selected.indexOf(p.id);
            return (
              <button key={p.id} type="button" className={`chip ${order >= 0 ? 'selected' : ''}`} style={{ '--chip-color': p.color }} aria-pressed={order >= 0} onClick={() => toggle(p.id)}>
                {order >= 0 && <span className="order" aria-hidden="true">{order + 1}</span>}
                <span className="avatar" aria-hidden="true">{p.emoji}</span>{p.name}
              </button>
            );
          })}
          {roster.length < ROSTER_LIMIT && (
            <button type="button" className="chip chip-add" onClick={() => setAdding(true)}><IconPlus /> لاعب جديد</button>
          )}
        </div>
        {roster.length === 0 && <p className="card-muted" style={{ marginTop: 10 }}>أضف لاعبين إلى الدفتر مرة واحدة، ويُعاد استخدامهم في كل الألعاب.</p>}
        {players.length < min && <p className="setup-error" style={{ marginTop: 10 }}>اختر {min} لاعبين على الأقل</p>}
      </Card>
      {children}
      {error && <p className="setup-error" role="alert">{error}</p>}
      <div className="setup-sticky">
        <Button variant="accent" size="lg" full disabled={!canStart} onClick={() => onStart(players)}>{startLabel} · {players.length} لاعبين</Button>
      </div>
      {adding && (
        <Modal title="لاعب جديد" onClose={() => { setAdding(false); setError(''); }} footer={<Button variant="primary" size="lg" full onClick={submitAdd}>إضافة</Button>}>
          <label className="field"><span>الاسم</span><input className="input" value={name} maxLength={20} autoFocus onChange={(e) => { setName(e.target.value); setError(''); }} onKeyDown={(e) => e.key === 'Enter' && submitAdd()} placeholder="مثال: نورة" /></label>
          <div className="field"><span>الإيموجي</span>
            <div className="emoji-grid">{EMOJIS.map((e) => <button key={e} type="button" className={emoji === e ? 'selected' : ''} aria-pressed={emoji === e} aria-label={`إيموجي ${e}`} onClick={() => setEmoji(e)}>{e}</button>)}</div>
          </div>
          {error && <p className="setup-error" role="alert">{error}</p>}
        </Modal>
      )}
    </div>
  );
}

import { tr } from '../i18n/core.js';
import { Avatar, AvatarPicker, ClayStage } from '../brand/art.jsx';
// اختيار اللاعبين من دفتر اللاعبين (أو إضافة لاعب سريع)، بترتيب الاختيار.
import React, { useState } from 'react';
import { Button, Card, Modal } from '../ui/components.jsx';
import { IconCheck, IconClose, IconPlus, IconUsers } from '../ui/icons.jsx';
import { addPlayer, ROSTER_LIMIT } from './roster.js';
import { useSubmitKey } from '../ui/useSubmitKey.js';

export function PlayersSetup({ roster, setRoster, min = 2, max = 10, accent, onStart, children, startLabel = tr("ابدأ اللعب"), startDisabled = false, api, designPreviewAdding = false }) {
  const [selected, setSelected] = useState(() => roster.slice(0, Math.min(max, roster.length)).map((p) => p.id));
  const [adding, setAdding] = useState(!!designPreviewAdding);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(null);
  const [error, setError] = useState('');

  const toggle = (id) => {
    setError('');
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
  const submitKeys = useSubmitKey(submitAdd);
  const players = selected.map((id) => roster.find((p) => p.id === id)).filter(Boolean);
  const canStart = players.length >= min && !startDisabled;

  return (
    <div data-design-screen="play-setup" data-design-id="players-setup" className="stack players-setup">
      <Card className="players-setup-card">
        <div className="row-between players-setup-heading">
          <span className="card-title"><IconUsers />{tr(" اللاعبون")}</span>
          <span className="badge" aria-label={tr("{v0} من {v1} لاعبين", {v0: players.length, v1: max})}>{players.length}/{max}</span>
        </div>
        <div data-design-id="players" className="chips players-setup-list">
          {roster.map((p) => {
            const order = selected.indexOf(p.id);
            return (
              <button key={p.id} type="button" data-design-id="player-choice" className={`chip ${order >= 0 ? 'selected' : ''}`} style={{ '--chip-color': p.color }} aria-pressed={order >= 0} onClick={() => toggle(p.id)}>
                <ClayStage className="clay-static no-contact"><Avatar player={p} className="avatar" /></ClayStage>
                <span className="players-setup-name">{p.name}</span>
                <span className="players-setup-selection" aria-hidden="true">{order >= 0 ? <><b>{order + 1}</b><IconClose /></> : <IconCheck />}</span>
              </button>
            );
          })}
          {roster.length < ROSTER_LIMIT && (
            <button type="button" data-design-id="add-player" className="chip chip-add" onClick={() => setAdding(true)}><IconPlus />{tr(" إضافة لاعب")}</button>
          )}
        </div>
        {roster.length === 0 && <p className="card-muted" style={{ marginTop: 10 }}>{tr("أضف لاعبين إلى الدفتر مرة واحدة، ويُعاد استخدامهم في كل الألعاب.")}</p>}
        {players.length < min && <p className="setup-error" style={{ marginTop: 10 }}>{tr("اختر ")}{min}{tr(" لاعبين على الأقل")}</p>}
      </Card>
      {children}
      {error && <p className="setup-error" role="alert">{tr(error)}</p>}
      <div data-design-id="actions" className="setup-sticky">
        <Button variant="accent" size="lg" full disabled={!canStart} data-design-id="start" data-design-required="true" onClick={() => onStart(players)}>{startLabel} · {players.length === 1 ? tr("لاعب واحد") : <>{players.length}{tr(" لاعبين")}</>}</Button>
      </div>
      {adding && (
        <Modal data-design-screen="setup.add-player" title={tr("لاعب جديد")} onClose={() => { setAdding(false); setError(''); }} footer={<Button variant="primary" size="lg" full data-design-id="add-player" onClick={submitAdd}>{tr("إضافة")}</Button>}>
          <label className="field"><span>{tr("الاسم")}</span><input data-design-id="name-input" className="input" value={name} maxLength={20} autoFocus onChange={(e) => { setName(e.target.value); setError(''); }} {...submitKeys} placeholder={tr("مثال: نورة")} /></label>
          <div className="field"><span>{tr("اختر شخصيتك")}</span>
            <AvatarPicker value={emoji} onChange={setEmoji} />
          </div>
          {error && <p className="setup-error" role="alert">{tr(error)}</p>}
        </Modal>
      )}
    </div>
  );
}

// من فريقين إلى أربعة بأسماء مختلفة.
import React, { useState } from 'react';
import { Button, Card, Segment } from '../ui/components.jsx';
import { makeTeams, validateTeamNames } from './roster.js';

export function TeamsSetup({ min = 2, max = 4, onStart, children, startLabel = 'ابدأ اللعب', api }) {
  const [count, setCount] = useState(min);
  const [names, setNames] = useState(() => makeTeams(max).map((t) => t.name));
  const [error, setError] = useState('');
  const teams = makeTeams(count, names);
  const start = () => {
    const v = validateTeamNames(names.slice(0, count));
    if (!v.ok) { setError(v.message); return; }
    onStart(makeTeams(count, v.names));
  };
  const options = [];
  for (let n = min; n <= max; n += 1) options.push({ value: n, label: `${n} فرق` });
  return (
    <div className="stack">
      <Card>
        <span className="card-title" style={{ display: 'block', marginBottom: 10 }}>الفرق</span>
        <Segment label="عدد الفرق" accent options={options} value={count} onChange={(v) => { setCount(v); setError(''); api && api.sound.play('click'); }} />
        <div className="stack" style={{ marginTop: 12 }}>
          {teams.map((t, i) => (
            <label key={t.id} className="team-input" style={{ '--team-color': t.color }}>
              <span aria-hidden="true">{t.emoji}</span>
              <input className="input" value={names[i]} maxLength={20} aria-label={`اسم الفريق ${i + 1}`} onChange={(e) => { const next = [...names]; next[i] = e.target.value; setNames(next); setError(''); }} />
            </label>
          ))}
        </div>
      </Card>
      {children}
      {error && <p className="setup-error" role="alert">{error}</p>}
      <div className="setup-sticky"><Button variant="accent" size="lg" full onClick={start}>{startLabel}</Button></div>
    </div>
  );
}

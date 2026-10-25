import React, { useEffect, useRef, useState } from 'react';
import { useAccount } from '../shared/account/context.js';
import { reviewDrawingPath } from './client.js';
import { createDrawingState, applyDrawingEvent, paintDrawing } from '../games/ersomha/drawing.js';

export function ReviewDrawing({ path }) {
  const account = useAccount();
  const owner = account.signedIn ? account.user?.id : null;
  const request = account.requestAuthenticated;
  const valid = reviewDrawingPath(path);
  const [state, setState] = useState(null);
  const [retry, setRetry] = useState(0);
  const canvas = useRef(null);
  useEffect(() => {
    let current = true;
    if (!owner || !valid) return undefined;
    setState(null);
    request(valid).then(evidence => {
      if (current) setState({ owner, path: valid, evidence });
    }, () => { if (current) setState({ owner, path: valid, error: true }); });
    return () => { current = false; };
  }, [owner, valid, request, retry]);
  const shown = state?.owner === owner && state?.path === valid ? state : null;
  useEffect(() => {
    const context = canvas.current?.getContext('2d');
    const evidence = shown?.evidence;
    if (!context || !evidence?.canvas) return;
    const model = createDrawingState(evidence.canvas.epoch);
    applyDrawingEvent(model, { kind: 'sync', ...evidence.canvas, ops: evidence.canvas.strokes });
    paintDrawing(context, model);
  }, [shown]);
  if (!owner || !valid) return null;
  return <div className="review-image review-drawing">
    {shown?.evidence ? <><canvas ref={canvas} width={1000} height={1000} role="img" aria-label="نسخة الرسمة وقت الإبلاغ" style={{ width: '100%', aspectRatio: '1', background: '#fff', borderRadius: 16 }} /><p className="moderation-note">نسخة خاصة محفوظة من الغرفة · الدور {shown.evidence.round}</p></>
      : shown?.error ? <div role="status"><p>تعذّر تحميل الرسمة.</p><button type="button" className="review-retry" onClick={() => setRetry(value => value + 1)}>إعادة المحاولة</button></div>
      : <p role="status">جارٍ تحميل الرسمة للمراجعة…</p>}
  </div>;
}

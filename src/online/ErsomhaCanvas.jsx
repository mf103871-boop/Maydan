import React, { useEffect, useRef, useState } from 'react';
import { Button, ConfirmModal } from '../shared/ui/components.jsx';
import { ERSOMHA_PALETTE, ERSOMHA_WIDTHS, DRAW_BATCH_MS, DRAW_BATCH_POINTS, DRAW_MAX_PENDING, DRAW_MAX_BUFFERED_BYTES, drawingPoint, createDrawingState, applyDrawingEvent, drawStroke, paintDrawing } from '../games/ersomha/drawing.js';

const COLOUR_LABELS = ['بنفسجي داكن', 'أبيض', 'فيروزي', 'بنفسجي', 'أحمر', 'أصفر', 'أخضر', 'أزرق', 'وردي', 'بني', 'برتقالي', 'رمادي'];
function strokeId() { return `s${Array.from(crypto.getRandomValues(new Uint8Array(10)), value => value.toString(16).padStart(2, '0')).join('')}`; }

/** The high-frequency pointer path intentionally lives outside React state. */
export function ErsomhaCanvas({ client, roundKey, epoch, serverSeq = 0, canDraw, paused, connected, onError = () => {}, onReport, label = 'لوحة الرسم المباشر' }) {
  const canvasRef = useRef(null), modelRef = useRef(createDrawingState(epoch)), optimisticRef = useRef(new Map());
  const activeRef = useRef(null), queueRef = useRef([]), pendingRef = useRef(0), timerRef = useRef(null), mountedRef = useRef(false);
  const currentRef = useRef({}), syncPendingRef = useRef(false), wasConnectedRef = useRef(connected);
  const generationRef = useRef(0), syncRequestRef = useRef(0);
  const [colour, setColour] = useState(ERSOMHA_PALETTE[0]), [width, setWidth] = useState(6), [tool, setTool] = useState('pen');
  const [clearConfirm, setClearConfirm] = useState(false), [history, setHistory] = useState({ undo: false, redo: false }), [syncing, setSyncing] = useState(true), [backpressure, setBackpressure] = useState(false);
  currentRef.current = { client, canDraw, paused, connected, colour, width, tool, epoch, roundKey, onError };
  const repaint = () => { const context = canvasRef.current?.getContext('2d'); if (context) paintDrawing(context, modelRef.current, optimisticRef.current); };
  const updateHistory = () => setHistory({ undo: [...modelRef.current.strokes.values()].some(stroke => stroke.end && !modelRef.current.undoneIds.has(stroke.strokeId)), redo: modelRef.current.undoneIds.size > 0 });
  const requestSync = () => {
    const current = currentRef.current;
    if (!current.connected || !current.client || syncPendingRef.current) return;
    const request = ++syncRequestRef.current;
    syncPendingRef.current = true;
    setSyncing(true);
    current.client.command('drawing_sync', { epoch: modelRef.current.epoch ?? current.epoch }).catch(error => { if (mountedRef.current && request === syncRequestRef.current) { setSyncing(false); currentRef.current.onError(error.code || 'DISCONNECTED'); } }).finally(() => { if (request === syncRequestRef.current) syncPendingRef.current = false; });
  };
  const drain = () => {
    timerRef.current = null;
    const current = currentRef.current;
    if (!current.connected || current.paused || !current.canDraw || !current.client) return;
    if (pendingRef.current >= DRAW_MAX_PENDING || Number(current.client.ws?.bufferedAmount || 0) > DRAW_MAX_BUFFERED_BYTES) {
      setBackpressure(true); timerRef.current = setTimeout(drain, DRAW_BATCH_MS); return;
    }
    setBackpressure(false);
    const next = queueRef.current.shift();
    if (!next) { setBackpressure(false); return; }
    pendingRef.current++;
    const requestRound = current.roundKey;
    const generation = generationRef.current;
    current.client.command('drawing_batch', { epoch: modelRef.current.epoch, ...next }).catch(error => {
      if (!mountedRef.current || currentRef.current.roundKey !== requestRound || generation !== generationRef.current) return;
      queueRef.current = []; activeRef.current = null; optimisticRef.current.clear(); repaint();
      currentRef.current.onError(error.code || 'DISCONNECTED'); requestSync();
    }).finally(() => {
      if (!mountedRef.current || currentRef.current.roundKey !== requestRound || generation !== generationRef.current) return;
      pendingRef.current = Math.max(0, pendingRef.current - 1);
      if (!queueRef.current.length && pendingRef.current < DRAW_MAX_PENDING && Number(currentRef.current.client?.ws?.bufferedAmount || 0) <= DRAW_MAX_BUFFERED_BYTES) setBackpressure(false);
      if (queueRef.current.length && !timerRef.current) timerRef.current = setTimeout(drain, DRAW_BATCH_MS);
    });
    if (queueRef.current.length) timerRef.current = setTimeout(drain, DRAW_BATCH_MS);
  };
  const enqueueActive = (end = false) => {
    const active = activeRef.current;
    if (!active) return;
    const points = active.unsent.splice(0, DRAW_BATCH_POINTS);
    if (!points.length && !end) return;
    queueRef.current.push({ strokeId: active.strokeId, points, color: active.color, width: active.width, tool: active.tool, end });
    if (!timerRef.current) timerRef.current = setTimeout(drain, DRAW_BATCH_MS);
  };
  const finishStroke = () => {
    const active = activeRef.current;
    if (!active) return;
    while (active.unsent.length > DRAW_BATCH_POINTS) enqueueActive(false);
    enqueueActive(true); active.end = true; activeRef.current = null;
  };
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; clearTimeout(timerRef.current); queueRef.current = []; };
  }, []);
  useEffect(() => {
    generationRef.current++; syncRequestRef.current++;
    clearTimeout(timerRef.current); timerRef.current = null; queueRef.current = []; activeRef.current = null; optimisticRef.current.clear(); pendingRef.current = 0; syncPendingRef.current = false;
    modelRef.current = createDrawingState(epoch); setSyncing(true); setBackpressure(false); setClearConfirm(false); setHistory({ undo: false, redo: false }); repaint();
    let pieces = null;
    const unsubscribe = client?.subscribeDrawing(event => {
      if (event.matchId != null && String(event.matchId) !== String(currentRef.current.roundKey.split(':')[0])) return;
      if (event.round != null && String(event.round) !== String(currentRef.current.roundKey.split(':')[1])) return;
      if (event.kind === 'sync' && Number(event.chunks) > 1) {
        if (!pieces || pieces.epoch !== event.epoch || pieces.seq !== event.seq) pieces = { epoch: event.epoch, seq: event.seq, chunks: new Map() };
        pieces.chunks.set(event.chunk, event);
        if (pieces.chunks.size !== event.chunks) return;
        const parts = [...pieces.chunks.values()].sort((a, b) => a.chunk - b.chunk);
        event = { ...event, ops: parts.flatMap(part => part.ops || []), undoneIds: parts.flatMap(part => part.undoneIds || []) }; pieces = null;
      }
      if (event.kind !== 'sync' && event.kind !== 'clear' && event.epoch !== modelRef.current.epoch) { requestSync(); return; }
      if (event.kind !== 'sync' && event.kind !== 'clear' && event.seq > modelRef.current.seq + 1) { requestSync(); return; }
      if (!applyDrawingEvent(modelRef.current, event)) return;
      if (event.kind === 'sync' || event.kind === 'clear') {
        generationRef.current++; pendingRef.current = 0;
        clearTimeout(timerRef.current); timerRef.current = null;
        optimisticRef.current.clear(); activeRef.current = null; queueRef.current = []; setSyncing(false);
      }
      else if (event.kind === 'append' && event.op?.end) optimisticRef.current.delete(event.op.strokeId);
      updateHistory(); repaint();
    });
    if (connected) requestSync();
    return () => { unsubscribe?.(); clearTimeout(timerRef.current); timerRef.current = null; };
  }, [client, roundKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Clear deltas advance the board epoch without a game-state broadcast. A later
  // matching snapshot must not reset fresh ink; a missed clear requests a sync.
  useEffect(() => {
    if (Number.isSafeInteger(epoch) && epoch > modelRef.current.epoch) requestSync();
  }, [epoch]);
  useEffect(() => {
    if (connected && !wasConnectedRef.current) requestSync();
    else if (!connected) { clearTimeout(timerRef.current); timerRef.current = null; activeRef.current = null; queueRef.current = []; optimisticRef.current.clear(); setSyncing(true); repaint(); }
    wasConnectedRef.current = connected;
  }, [connected]);
  useEffect(() => {
    if (!paused && canDraw) return;
    setClearConfirm(false);
    clearTimeout(timerRef.current); timerRef.current = null; queueRef.current = []; activeRef.current = null; optimisticRef.current.clear(); repaint();
  }, [paused, canDraw]);
  // State snapshots can race a drawing delta after a dropped frame. One sync
  // reconciles the board without requesting message history or a second socket.
  useEffect(() => {
    if (connected && serverSeq > modelRef.current.seq && !activeRef.current && pendingRef.current === 0) requestSync();
  }, [serverSeq]); // eslint-disable-line react-hooks/exhaustive-deps
  const blocked = !canDraw || !connected || paused || syncing || backpressure;
  const pointerDown = event => {
    if (blocked || activeRef.current || event.button > 0 || queueRef.current.length >= DRAW_MAX_PENDING * 2) return;
    const point = drawingPoint(event, event.currentTarget.getBoundingClientRect());
    if (!point) return;
    event.preventDefault(); event.currentTarget.setPointerCapture?.(event.pointerId);
    const stroke = { strokeId: strokeId(), points: [point], unsent: [point], color: colour, width, tool, end: false, pointerId: event.pointerId };
    activeRef.current = stroke; optimisticRef.current.set(stroke.strokeId, stroke);
    drawStroke(event.currentTarget.getContext('2d'), { ...stroke, points: [point] });
  };
  const pointerMove = event => {
    const active = activeRef.current;
    if (!active || active.pointerId !== event.pointerId || blocked) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const events = event.nativeEvent?.getCoalescedEvents?.() || [event];
    for (const sample of events) {
      const point = drawingPoint(sample, bounds), previous = active.points.at(-1);
      if (!point || Math.hypot(point[0] - previous[0], point[1] - previous[1]) < 0.001) continue;
      active.points.push(point); active.unsent.push(point);
      drawStroke(event.currentTarget.getContext('2d'), { ...active, points: [previous, point] });
      if (active.unsent.length >= DRAW_BATCH_POINTS) enqueueActive(false);
    }
    if (active.unsent.length && !timerRef.current) timerRef.current = setTimeout(() => { enqueueActive(false); drain(); }, DRAW_BATCH_MS);
    if (queueRef.current.length >= DRAW_MAX_PENDING * 2) { finishStroke(); setBackpressure(true); }
  };
  const changeHistory = async type => {
    finishStroke();
    if (queueRef.current.length || pendingRef.current) { currentRef.current.onError('DRAW_PENDING'); return; }
    try { await client.command(type, { epoch: modelRef.current.epoch }); }
    catch (error) { onError(error.code || 'DISCONNECTED'); requestSync(); }
  };
  return <section className={`ers-canvas-panel ${canDraw ? 'is-drawer' : ''}`} aria-label={label}>
    <div className="ers-board-wrap">
      <canvas ref={canvasRef} width="1000" height="1000" className="ers-board" role="img" aria-label={canDraw ? 'لوحتك: ارسم بالإصبع أو القلم أو الفأرة. استخدم الأدوات أسفلها.' : 'لوحة مباشرة يرسم عليها صاحب الدور. اكتب تخمينك أسفل اللوحة.'} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={event => { if (activeRef.current?.pointerId === event.pointerId) finishStroke(); }} onPointerCancel={finishStroke} onLostPointerCapture={finishStroke} style={{ touchAction: canDraw ? 'none' : 'pan-y' }} />
      {(syncing || paused || !connected) && <div className="ers-board-status" role="status"><span>{!connected ? 'نستعيد اتصالك والرسمة…' : paused ? 'ننتظر عودة الرسّام…' : 'نحضّر اللوحة…'}</span></div>}
    </div>
    {canDraw && <div className="ers-tools" aria-label="أدوات الرسم">
      <div className="ers-tool-row" role="group" aria-label="نوع الأداة"><Button size="sm" aria-pressed={tool === 'pen'} onClick={() => setTool('pen')}>✎ قلم</Button><Button size="sm" aria-pressed={tool === 'eraser'} onClick={() => setTool('eraser')}>ممحاة</Button><span className="ers-tool-divider" /><Button size="sm" aria-label="تراجع عن آخر خط" disabled={blocked || !history.undo} onClick={() => changeHistory('drawing_undo')}>↶</Button><Button size="sm" aria-label="إعادة الخط المتراجع عنه" disabled={blocked || !history.redo} onClick={() => changeHistory('drawing_redo')}>↷</Button><Button size="sm" aria-label="مسح اللوحة" disabled={blocked} onClick={() => setClearConfirm(true)}>مسح</Button></div>
      <div className="ers-colours" role="group" aria-label="ألوان القلم">{ERSOMHA_PALETTE.map((value, index) => <button type="button" key={value} className={`ers-colour ${colour === value ? 'selected' : ''}`} style={{ '--ink': value }} aria-label={COLOUR_LABELS[index]} aria-pressed={colour === value} disabled={tool === 'eraser'} onClick={() => setColour(value)}><span /></button>)}</div>
      <div className="ers-widths" role="group" aria-label="سماكة الخط">{ERSOMHA_WIDTHS.map((value, index) => <button type="button" key={value} aria-label={['خط رفيع', 'خط متوسط', 'خط عريض'][index]} aria-pressed={width === value} onClick={() => setWidth(value)}><i style={{ width: `${4 + index * 5}px`, height: `${4 + index * 5}px` }} /><span>{['رفيع', 'متوسط', 'عريض'][index]}</span></button>)}</div>
      {backpressure && <p className="ers-canvas-note" role="status">نثبت خطوطك… أمهل الاتصال لحظة قبل متابعة الرسم.</p>}
    </div>}
    {onReport && <button type="button" className="ers-report" onClick={onReport}>الإبلاغ عن الرسمة</button>}
    {clearConfirm && <ConfirmModal title="تمسح اللوحة؟" message="تبدأ لوحة بيضاء جديدة لهذا الدور. لا يمكن التراجع عن المسح." confirmLabel="مسح اللوحة" cancelLabel="إكمال الرسم" onCancel={() => setClearConfirm(false)} onConfirm={() => { setClearConfirm(false); changeHistory('drawing_clear'); }} />}
  </section>;
}

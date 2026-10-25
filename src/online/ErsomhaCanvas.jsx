import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, ConfirmModal, Modal } from '../shared/ui/components.jsx';
import { ERSOMHA_PALETTE, ERSOMHA_WIDTHS, DRAW_BATCH_MS, DRAW_BATCH_POINTS, DRAW_MAX_PENDING, DRAW_MAX_BUFFERED_BYTES, drawingPoint, createDrawingState, applyDrawingEvent, drawStroke, paintDrawing } from '../games/ersomha/drawing.js';
import { drawingCamera, inkOutsideCamera } from '../games/ersomha/camera.js';
import { ErsomhaToolIcon, ErsomhaToolStyles } from './ErsomhaToolIcon.jsx';

const COLOUR_LABELS = ['بنفسجي داكن', 'أبيض', 'فيروزي', 'بنفسجي', 'أحمر', 'أصفر', 'أخضر', 'أزرق', 'وردي', 'بني', 'برتقالي', 'رمادي'];
function strokeId() { return `s${Array.from(crypto.getRandomValues(new Uint8Array(10)), value => value.toString(16).padStart(2, '0')).join('')}`; }
const drawingRound = key => { const [matchId, round] = String(key).split(':').map(Number); return { matchId, round }; };

/** The high-frequency pointer path intentionally lives outside React state. */
export function ErsomhaCanvas({ client, roundKey, epoch, serverSeq = 0, canDraw, wide = false, paused, connected, onError = () => {}, onReport, label = 'لوحة الرسم المباشر' }) {
  const canvasRef = useRef(null), modelRef = useRef(createDrawingState(epoch)), optimisticRef = useRef(new Map());
  const activeRef = useRef(null), queueRef = useRef([]), pendingRef = useRef(0), timerRef = useRef(null), mountedRef = useRef(false);
  const currentRef = useRef({}), syncPendingRef = useRef(false), wasConnectedRef = useRef(connected);
  const generationRef = useRef(0), syncRequestRef = useRef(0);
  const pointerEndRef = useRef(null);
  const viewRef = useRef(null), cameraRef = useRef({ mode: 'wide', centerY: .5 }), panRef = useRef(null), resizeRef = useRef(null);
  const [cameraMode, setCameraMode] = useState('wide');
  const [colour, setColour] = useState(ERSOMHA_PALETTE[0]), [width, setWidth] = useState(6), [tool, setTool] = useState('pen');
  const [clearConfirm, setClearConfirm] = useState(false), [moreTools, setMoreTools] = useState(false), [history, setHistory] = useState({ undo: false, redo: false }), [syncing, setSyncing] = useState(true), [backpressure, setBackpressure] = useState(false);
  currentRef.current = { client, canDraw, wide, paused, connected, colour, width, tool, epoch, roundKey, onError };
  const repaint = () => { const context = canvasRef.current?.getContext('2d'); if (context) paintDrawing(context, modelRef.current, optimisticRef.current, viewRef.current); };
  const alignPaper = view => {
    const canvas = canvasRef.current, paper = canvas?.previousElementSibling;
    if (!canvas || !paper || !view) return;
    const size = view.scale * 1000;
    // Studio can move this viewport within its wrapper independently of size.
    // Keep the white world beneath the same local origin and visible rectangle.
    Object.assign(paper.style, { left: `${canvas.offsetLeft + view.offsetX}px`, top: `${canvas.offsetTop + view.offsetY}px`, width: `${size}px`, height: `${size}px`,
      clipPath: `inset(${Math.max(0, -view.offsetY)}px ${Math.max(0, view.offsetX + size - view.width)}px ${Math.max(0, view.offsetY + size - view.height)}px ${Math.max(0, -view.offsetX)}px)` });
  };
  const installView = view => {
    const canvas = canvasRef.current;
    if (!canvas || !view) return;
    if (canvas.width !== view.pixelWidth) canvas.width = view.pixelWidth;
    if (canvas.height !== view.pixelHeight) canvas.height = view.pixelHeight;
    viewRef.current = view;
    alignPaper(view);
    canvas.dataset.cameraMode = view.mode; canvas.dataset.cameraCenter = String(view.centerY);
    setCameraMode(view.mode); repaint();
  };
  const configureCanvas = ({ fitHidden = true } = {}) => {
    const canvas = canvasRef.current;
    if (!canvas?.clientWidth || !canvas.clientHeight) return;
    const current = currentRef.current;
    const preference = current.canDraw && current.wide ? cameraRef.current : { mode: 'fit' };
    let view = drawingCamera(canvas.clientWidth, canvas.clientHeight, { ...preference, dpr: window.devicePixelRatio });
    const previous = viewRef.current;
    setCameraMode(view.mode);
    if (view.mode === 'fit' && current.tool === 'hand') setTool('pen');
    if (previous && previous.width === view.width && previous.height === view.height && previous.mode === view.mode && previous.dpr === view.dpr && previous.centerY === view.centerY) { alignPaper(view); return; }
    // Freeze canonical points before a new projection or backing size is used.
    finishStroke(); panRef.current = null;
    if (fitHidden && previous && inkOutsideCamera(view, modelRef.current, optimisticRef.current)) {
      cameraRef.current = { mode: 'fit', centerY: .5 };
      view = drawingCamera(canvas.clientWidth, canvas.clientHeight, { mode: 'fit', dpr: window.devicePixelRatio });
    }
    if (view.mode === 'fit' && current.tool === 'hand') setTool('pen');
    installView(view);
  };
  resizeRef.current = configureCanvas;
  const changeCamera = () => {
    finishStroke(); panRef.current = null;
    cameraRef.current = { mode: cameraRef.current.mode === 'wide' ? 'fit' : 'wide', centerY: .5 };
    configureCanvas({ fitHidden: false });
  };
  const panCamera = centerY => {
    const view = viewRef.current;
    if (view?.mode !== 'wide') return;
    const next = drawingCamera(view.width, view.height, { mode: 'wide', centerY, dpr: view.dpr });
    cameraRef.current = { mode: 'wide', centerY: next.centerY }; installView(next);
  };
  const cameraKeys = event => {
    if (!['ArrowUp', 'ArrowDown', 'Home'].includes(event.key) || viewRef.current?.mode !== 'wide') return;
    event.preventDefault(); finishStroke();
    panCamera(event.key === 'Home' ? .5 : viewRef.current.centerY + (event.key === 'ArrowUp' ? -1 : 1) * .12);
  };
  const updateHistory = () => setHistory({ undo: [...modelRef.current.strokes.values()].some(stroke => stroke.end && !modelRef.current.undoneIds.has(stroke.strokeId)), redo: modelRef.current.undoneIds.size > 0 });
  const requestSync = () => {
    const current = currentRef.current;
    if (!current.connected || !current.client || syncPendingRef.current) return;
    const request = ++syncRequestRef.current;
    syncPendingRef.current = true;
    setSyncing(true);
    current.client.command('drawing_sync', { ...drawingRound(current.roundKey), epoch: modelRef.current.epoch ?? current.epoch }).catch(error => { if (mountedRef.current && request === syncRequestRef.current) { setSyncing(false); currentRef.current.onError(error.code || 'DISCONNECTED'); } }).finally(() => { if (request === syncRequestRef.current) syncPendingRef.current = false; });
  };
  const drain = () => {
    timerRef.current = null;
    const current = currentRef.current;
    if (!current.connected || current.paused || !current.canDraw || !current.client) return;
    // A drain can replace the pointer's scheduled flush while older batches
    // are queued. Flush its unsent tail here too, even if the finger now rests.
    while (activeRef.current?.unsent.length) enqueueActive(false, false);
    if (pendingRef.current >= DRAW_MAX_PENDING || Number(current.client.ws?.bufferedAmount || 0) > DRAW_MAX_BUFFERED_BYTES) {
      setBackpressure(true); timerRef.current = setTimeout(drain, DRAW_BATCH_MS); return;
    }
    setBackpressure(false);
    const next = queueRef.current.shift();
    if (!next) { setBackpressure(false); return; }
    pendingRef.current++;
    const requestRound = current.roundKey;
    const generation = generationRef.current;
    current.client.command('drawing_batch', { ...drawingRound(current.roundKey), epoch: modelRef.current.epoch, ...next }).catch(error => {
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
  const enqueueActive = (end = false, schedule = true) => {
    const active = activeRef.current;
    if (!active) return;
    const points = active.unsent.splice(0, DRAW_BATCH_POINTS);
    if (!points.length && !end) return;
    queueRef.current.push({ strokeId: active.strokeId, points, color: active.color, width: active.width, tool: active.tool, end });
    if (schedule && !timerRef.current) timerRef.current = setTimeout(drain, DRAW_BATCH_MS);
  };
  const finishStroke = () => {
    const active = activeRef.current;
    if (!active) return;
    while (active.unsent.length > DRAW_BATCH_POINTS) enqueueActive(false);
    enqueueActive(true); active.end = true; activeRef.current = null;
  };
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let frame;
    const schedule = () => { if (frame == null) frame = requestAnimationFrame(() => { frame = null; resizeRef.current?.(); }); };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    const positionObserver = typeof MutationObserver === 'undefined' ? null : new MutationObserver(schedule);
    positionObserver?.observe(canvas, { attributes: true, attributeFilter: ['style'] });
    observer?.observe(canvas); schedule(); window.addEventListener('resize', schedule);
    return () => { observer?.disconnect(); positionObserver?.disconnect(); window.removeEventListener('resize', schedule); if (frame != null) cancelAnimationFrame(frame); };
  }, []);
  useLayoutEffect(() => { resizeRef.current?.(); }, [wide, canDraw]);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; clearTimeout(timerRef.current); queueRef.current = []; };
  }, []);
  useEffect(() => {
    generationRef.current++; syncRequestRef.current++;
    clearTimeout(timerRef.current); timerRef.current = null; queueRef.current = []; activeRef.current = null; optimisticRef.current.clear(); pendingRef.current = 0; syncPendingRef.current = false;
    modelRef.current = createDrawingState(epoch); setSyncing(true); setBackpressure(false); setClearConfirm(false); setMoreTools(false); setHistory({ undo: false, redo: false }); repaint();
    cameraRef.current = { mode: 'wide', centerY: .5 }; setCameraMode('wide'); panRef.current = null; resizeRef.current?.({ fitHidden: false });
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
    setClearConfirm(false); setMoreTools(false);
    clearTimeout(timerRef.current); timerRef.current = null; queueRef.current = []; activeRef.current = null; optimisticRef.current.clear(); repaint();
  }, [paused, canDraw]);
  // State snapshots can race a drawing delta after a dropped frame. One sync
  // reconciles the board without requesting message history or a second socket.
  useEffect(() => {
    if (connected && serverSeq > modelRef.current.seq && !activeRef.current && pendingRef.current === 0) requestSync();
  }, [serverSeq]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const board = canvasRef.current;
    if (!board) return undefined;
    // WebKit's long-press selection/callout is separate from Pointer Events.
    // Keep the prevention local: guessing and chat inputs remain real editors.
    const preventEditing = event => { if (currentRef.current.canDraw) event.preventDefault(); };
    for (const type of ['selectstart', 'contextmenu', 'dragstart']) board.addEventListener(type, preventEditing);
    return () => { for (const type of ['selectstart', 'contextmenu', 'dragstart']) board.removeEventListener(type, preventEditing); };
  }, []);
  useEffect(() => {
    // A browser can reject capture after a transient app/keyboard change.
    // Still close this pointer's stroke if its release lands outside the board.
    const endOutside = event => {
      const board = canvasRef.current;
      if (!board || event.target === board || (activeRef.current?.pointerId !== event.pointerId && panRef.current?.pointerId !== event.pointerId)) return;
      pointerEndRef.current?.({ type: event.type, pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, currentTarget: board, nativeEvent: event, preventDefault: () => event.preventDefault() });
    };
    document.addEventListener('pointerup', endOutside); document.addEventListener('pointercancel', endOutside);
    return () => { document.removeEventListener('pointerup', endOutside); document.removeEventListener('pointercancel', endOutside); };
  }, []);
  const blocked = !canDraw || !connected || paused || syncing || backpressure;
  const pointerDown = event => {
    if (canDraw) {
      // End the previous text editor before drawing, without changing its draft.
      // Prevent selection even while synchronizing or while a second finger lands.
      event.preventDefault();
      const editor = document.activeElement;
      if (editor?.matches('input,textarea,[contenteditable="true"]')) editor.blur();
      const selection = window.getSelection?.();
      if (selection?.anchorNode && event.currentTarget.parentElement?.contains(selection.anchorNode)) selection.removeAllRanges();
    }
    if (activeRef.current || panRef.current || event.isPrimary === false || event.button > 0) return;
    if (canDraw && tool === 'hand' && viewRef.current?.mode === 'wide') {
      const bounds = event.currentTarget.getBoundingClientRect();
      panRef.current = { pointerId: event.pointerId, y: event.clientY, centerY: viewRef.current.centerY, ratio: viewRef.current.height / bounds.height, scale: viewRef.current.scale };
      try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* outside release is still observed */ }
      return;
    }
    if (blocked || tool === 'hand' || queueRef.current.length >= DRAW_MAX_PENDING * 2) return;
    const point = drawingPoint(event, event.currentTarget.getBoundingClientRect(), { view: viewRef.current, clampOutside: false });
    if (!point) return;
    event.preventDefault();
    try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* A retiring pointer can already be unavailable. */ }
    const stroke = { strokeId: strokeId(), points: [point], unsent: [point], color: colour, width, tool, end: false, pointerId: event.pointerId };
    activeRef.current = stroke; optimisticRef.current.set(stroke.strokeId, stroke);
    drawStroke(event.currentTarget.getContext('2d'), { ...stroke, points: [point] }, viewRef.current);
  };
  const pointerMove = event => {
    const pan = panRef.current;
    if (pan?.pointerId === event.pointerId) { event.preventDefault(); panCamera(pan.centerY - (event.clientY - pan.y) * pan.ratio / (pan.scale * 1000)); return; }
    const active = activeRef.current;
    if (!active || active.pointerId !== event.pointerId || blocked) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const coalesced = event.nativeEvent?.getCoalescedEvents?.();
    const events = coalesced?.length ? coalesced : [event];
    for (const sample of events) {
      const point = drawingPoint(sample, bounds, { view: viewRef.current }), previous = active.points.at(-1);
      if (!point || Math.hypot(point[0] - previous[0], point[1] - previous[1]) < 0.001) continue;
      active.points.push(point); active.unsent.push(point);
      drawStroke(event.currentTarget.getContext('2d'), { ...active, points: [previous, point] }, viewRef.current);
      if (active.unsent.length >= DRAW_BATCH_POINTS) enqueueActive(false);
    }
    if (active.unsent.length && !timerRef.current) timerRef.current = setTimeout(() => { enqueueActive(false); drain(); }, DRAW_BATCH_MS);
    if (queueRef.current.length >= DRAW_MAX_PENDING * 2) { finishStroke(); setBackpressure(true); }
  };
  const pointerEnd = event => {
    if (panRef.current?.pointerId === event.pointerId) { panRef.current = null; return; }
    if (activeRef.current?.pointerId !== event.pointerId) return;
    // A fast down/up can have no move callback; preserve its final position.
    if (event.type === 'pointerup' && !blocked) pointerMove(event);
    finishStroke();
  };
  pointerEndRef.current = pointerEnd;
  const changeHistory = async type => {
    finishStroke();
    if (queueRef.current.length || pendingRef.current) { currentRef.current.onError('DRAW_PENDING'); return; }
    const current = currentRef.current;
    const requestRound = current.roundKey, generation = generationRef.current;
    const stillCurrent = () => mountedRef.current && currentRef.current.roundKey === requestRound && generation === generationRef.current;
    try { await current.client.command(type, { ...drawingRound(current.roundKey), epoch: modelRef.current.epoch }); if (stillCurrent()) currentRef.current.onError(''); }
    catch (error) { if (stillCurrent()) { currentRef.current.onError(error.code || 'DISCONNECTED'); requestSync(); } }
  };
  const selectTool = value => { finishStroke(); panRef.current = null; setTool(value); };
  const chooseColour = value => { setColour(value); if (tool === 'hand') selectTool('pen'); };
  return <section data-design-id="canvas-panel" className={`ers-canvas-panel ${canDraw ? 'is-drawer' : ''}`} aria-label={label}>
    <ErsomhaToolStyles />
    <div className="ers-board-wrap">
      <div className="ers-world-paper" aria-hidden="true" />
      <canvas data-design-id="canvas" data-design-required="true" ref={canvasRef} width="1000" height="1000" className={`ers-board ${tool === 'hand' ? 'is-panning' : ''}`} role="img" contentEditable={false} inputMode="none" draggable={false} tabIndex={canDraw && tool === 'hand' ? 0 : undefined} onKeyDown={cameraKeys} aria-label={canDraw ? tool === 'hand' ? 'تحريك اللوحة: اسحب لأعلى أو لأسفل، أو استخدم الأسهم. زر اللوحة كاملة يعرض الرسم كله.' : 'لوحتك: ارسم بالإصبع أو القلم أو الفأرة. الأدوات بجانب اللوحة أو أسفلها.' : 'لوحة مباشرة يرسم عليها صاحب الدور. اكتب تخمينك أسفل اللوحة.'} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd} onLostPointerCapture={pointerEnd} style={{ touchAction: canDraw ? 'none' : 'pan-y' }} />
      {canDraw && tool === 'hand' && cameraMode === 'wide' && <span className="ers-camera-hint" role="status">اسحب اللوحة لأعلى أو لأسفل</span>}
      {(syncing || paused || !connected) && <div data-design-id="canvas-status" data-design-required="true" className="ers-board-status" role="status"><span>{!connected ? 'نستعيد اتصالك والرسمة…' : paused ? 'ننتظر عودة الرسّام…' : 'نحضّر اللوحة…'}</span></div>}
    </div>
    {canDraw && <div data-design-id="drawing-tools" data-design-required="true" className="ers-tools" aria-label="أدوات الرسم">
      <div className="ers-tool-row" role="group" aria-label="نوع الأداة"><Button size="sm" data-design-id="pen" aria-label="قلم" aria-pressed={tool === 'pen'} onClick={() => selectTool('pen')}><ErsomhaToolIcon name="pen" ink={colour} /><span className="ers-tool-label">قلم</span></Button><Button size="sm" data-design-id="eraser" aria-label="ممحاة" aria-pressed={tool === 'eraser'} onClick={() => selectTool('eraser')}><ErsomhaToolIcon name="eraser" /><span className="ers-tool-label">ممحاة</span></Button><span className="ers-tool-divider" /><Button size="sm" data-design-id="undo" aria-label="تراجع عن آخر خط" disabled={blocked || !history.undo} onClick={() => changeHistory('drawing_undo')}><ErsomhaToolIcon name="undo" /></Button><Button size="sm" data-design-id="redo" aria-label="إعادة الخط المتراجع عنه" disabled={blocked || !history.redo} onClick={() => changeHistory('drawing_redo')}><ErsomhaToolIcon name="redo" /></Button><Button size="sm" data-design-id="clear" aria-label="مسح اللوحة" disabled={blocked} onClick={() => setClearConfirm(true)}><ErsomhaToolIcon name="clear" /><span className="ers-tool-label">مسح</span></Button></div>
      <div data-design-id="palette" className="ers-colours" role="group" aria-label="ألوان القلم">{ERSOMHA_PALETTE.map((value, index) => <button data-design-id="color" type="button" key={value} className={`ers-colour ${colour === value ? 'selected' : ''}`} style={{ '--ink': value }} aria-label={COLOUR_LABELS[index]} aria-pressed={colour === value} disabled={tool === 'eraser'} onClick={() => chooseColour(value)}><span /></button>)}</div>
      <div data-design-id="widths" className="ers-widths" role="group" aria-label="سماكة الخط">{ERSOMHA_WIDTHS.map((value, index) => <button data-design-id="width" type="button" key={value} aria-label={['خط رفيع', 'خط متوسط', 'خط عريض'][index]} aria-pressed={width === value} onClick={() => setWidth(value)}><i style={{ width: `${4 + index * 5}px`, height: `${4 + index * 5}px` }} /><span>{['رفيع', 'متوسط', 'عريض'][index]}</span></button>)}</div>
      <div data-design-id="camera-controls" data-design-required="true" className="ers-camera-controls" role="group" aria-label="عرض اللوحة"><Button data-design-id="camera-view" data-design-required="true" className="ers-tool-button" aria-label={cameraMode === 'wide' ? 'عرض اللوحة كاملة' : 'مساحة الرسم الواسعة'} title={cameraMode === 'wide' ? 'شاهد الرسم كله' : 'استعمل كامل مساحة الهاتف'} onClick={changeCamera}><ErsomhaToolIcon name={cameraMode === 'wide' ? 'fit' : 'expand'} /></Button><Button data-design-id="camera-hand" data-design-required="true" className="ers-tool-button" disabled={cameraMode !== 'wide'} aria-label="تحريك اللوحة" title="اسحب لأعلى أو أسفل، أو استخدم الأسهم" aria-pressed={tool === 'hand'} onClick={() => selectTool(tool === 'hand' ? 'pen' : 'hand')} onKeyDown={cameraKeys}><ErsomhaToolIcon name="hand" /></Button></div>
      <Button data-design-id="tools-more" data-design-required="true" className="ers-tools-more" aria-label="ألوان وأدوات إضافية" aria-haspopup="dialog" style={{ '--ink': colour }} onClick={() => { finishStroke(); setMoreTools(true); }}><ErsomhaToolIcon name="palette" ink={colour} /><span className="ers-tool-label">المزيد</span></Button>
      {backpressure && <p className="ers-canvas-note" role="status">نثبت خطوطك… أمهل الاتصال لحظة قبل متابعة الرسم.</p>}
    </div>}
    {onReport && <button type="button" data-design-id="report" data-design-required="true" className="ers-report" onClick={onReport}>الإبلاغ عن الرسمة</button>}
    {moreTools && <Modal title="ألوان وأدوات الرسم" className="ers-tools-modal" onClose={() => setMoreTools(false)} footer={<Button full variant="primary" onClick={() => setMoreTools(false)}>إكمال الرسم</Button>}>
      <div className="ers-colours" role="group" aria-label="جميع ألوان القلم">{ERSOMHA_PALETTE.map((value, index) => <button type="button" key={value} className={`ers-colour ${colour === value ? 'selected' : ''}`} style={{ '--ink': value }} aria-label={COLOUR_LABELS[index]} aria-pressed={colour === value} disabled={tool === 'eraser'} onClick={() => chooseColour(value)}><span /></button>)}</div>
      <div className="ers-widths" role="group" aria-label="سماكة الخط">{ERSOMHA_WIDTHS.map((value, index) => <button type="button" key={value} aria-label={['خط رفيع', 'خط متوسط', 'خط عريض'][index]} aria-pressed={width === value} onClick={() => setWidth(value)}><i style={{ width: `${4 + index * 5}px`, height: `${4 + index * 5}px` }} /><span>{['رفيع', 'متوسط', 'عريض'][index]}</span></button>)}</div>
      <div className="ers-tool-row"><Button aria-label="إعادة الخط المتراجع عنه" disabled={blocked || !history.redo} onClick={() => changeHistory('drawing_redo')}><ErsomhaToolIcon name="redo" />إعادة الخط</Button><Button aria-label="مسح اللوحة" disabled={blocked} onClick={() => { setMoreTools(false); setClearConfirm(true); }}><ErsomhaToolIcon name="clear" />مسح اللوحة</Button></div>
    </Modal>}
    {clearConfirm && <ConfirmModal title="تمسح اللوحة؟" message="تبدأ لوحة بيضاء جديدة لهذا الدور. لا يمكن التراجع عن المسح." confirmLabel="مسح اللوحة" cancelLabel="إكمال الرسم" onCancel={() => setClearConfirm(false)} onConfirm={() => { setClearConfirm(false); changeHistory('drawing_clear'); }} />}
  </section>;
}

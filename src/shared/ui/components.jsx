import { Avatar, TrophyArtwork, ClayStage } from '../brand/art.jsx';
// المكونات المشتركة: زر، بطاقة، شارة، نافذة، ورقة سفلية، تنبيه، حلقة تقدم، لوحة نتائج، منصة تتويج، شاشة.
import React, { useEffect, useRef, useState, useCallback, createContext, useContext } from 'react';
import { createPortal } from 'react-dom';
import { IconClose } from './icons.jsx';
import { burstConfetti } from '../fx/confetti.js';
import { prefersReducedMotion, wait } from '../fx/screen.js';

// ── ripple ───────────────────────────────────────────────────
export function ripple(event) {
  const host = event.currentTarget;
  if (!host || host.disabled) return;
  try {
    const rect = host.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 0.6;
    const span = document.createElement('span');
    span.className = 'ripple';
    span.style.width = `${size}px`;
    span.style.height = `${size}px`;
    span.style.left = `${(event.clientX || rect.left + rect.width / 2) - rect.left - size / 2}px`;
    span.style.top = `${(event.clientY || rect.top + rect.height / 2) - rect.top - size / 2}px`;
    host.appendChild(span);
    setTimeout(() => span.remove(), wait(600));
  } catch (error) {
    // decorative only
  }
}

// ── Button ───────────────────────────────────────────────────
export function Button({ variant = 'secondary', size = 'md', full = false, loading = false, icon = null, className = '', children, onPointerDown, ...rest }) {
  const classes = ['btn', `btn-${variant}`, size === 'lg' ? 'btn-lg' : size === 'sm' ? 'btn-sm' : '', full ? 'btn-full' : '', className].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      className={classes}
      disabled={rest.disabled || loading}
      aria-busy={loading || undefined}
      onPointerDown={(e) => { ripple(e); onPointerDown && onPointerDown(e); }}
      {...rest}
    >
      {loading ? <span className="spinner" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({ label, children, className = '', ...rest }) {
  return (
    <button type="button" className={`btn btn-secondary btn-icon ${className}`} aria-label={label} title={label} onPointerDown={ripple} {...rest}>
      {children}
    </button>
  );
}

// ── Card / Badge ─────────────────────────────────────────────
export function Card({ className = '', children, ...rest }) {
  return <div className={`card ${className}`} {...rest}>{children}</div>;
}
export function Badge({ variant = '', children }) {
  return <span className={`badge ${variant ? `badge-${variant}` : ''}`}>{children}</span>;
}

// ── حوارات: تركيز محبوس وخلفية معطّلة ───────────────────────
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(node) {
  if (!node) return [];
  return Array.from(node.querySelectorAll(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
}

// التركيز الأول يذهب إلى أول عنصر داخل جسم الحوار (حقل الكتابة عادة) لا إلى
// زر الإغلاق في الترويسة.
function focusFirst(node) {
  if (!node) return;
  const marked = node.querySelector('[autofocus], [data-autofocus]');
  const body = node.querySelector('.modal-body');
  const target = marked || focusables(body)[0] || focusables(node)[0] || node;
  try { target.focus({ preventScroll: true }); } catch (error) { /* ignore */ }
}

// Tab وShift+Tab يدوران داخل الحوار فقط.
function trapTab(node, event) {
  if (!node) return;
  const list = focusables(node);
  if (!list.length) { event.preventDefault(); return; }
  const first = list[0];
  const last = list[list.length - 1];
  const active = document.activeElement;
  if (!node.contains(active)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); return; }
  if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
}

// ما خلف الحوار يصبح خارج الوصول (Tab وقارئ الشاشة والنقر)، ويعود كما كان عند الإغلاق.
function deactivateBackground(except) {
  if (typeof document === 'undefined' || !document.body) return () => {};
  if (except && except.inert) except.inert = false; // حوار فوق حوار: الأعلى يبقى فعّالًا
  const changed = [];
  for (const el of Array.from(document.body.children)) {
    if (el === except || (except && el.contains(except)) || el.inert) continue;
    el.inert = true;
    changed.push(el);
  }
  return () => { changed.forEach((el) => { el.inert = false; }); };
}

// متغيّرات موروثة تهمّ داخل الحوار (لون اللعبة الحالية مثلًا): الحوار يخرج من
// شجرة الشاشة فلا يرثها تلقائيًا، فننسخها إلى حاويته.
const INHERITED_VARS = ['--game-accent', '--pass-color', '--team-color'];

// الحوار يُصيَّر خارج شجرة الشاشة حتى يمكن تعطيل الشاشة كاملة خلفه.
function useDialogHost() {
  const anchor = useRef(null);
  const [host] = useState(() => {
    if (typeof document === 'undefined') return null;
    const el = document.createElement('div');
    el.className = 'dialog-host';
    return el;
  });
  useEffect(() => {
    if (!host) return undefined;
    document.body.appendChild(host);
    return () => { host.remove(); };
  }, [host]);
  // تُنادى عند الفتح: المرساة موجودة في مكان الحوار الأصلي داخل الشاشة.
  const syncVars = useCallback(() => {
    try {
      const source = anchor.current && anchor.current.parentElement;
      if (!host || !source) return;
      const styles = getComputedStyle(source);
      for (const name of INHERITED_VARS) {
        const value = styles.getPropertyValue(name);
        if (value && value.trim()) host.style.setProperty(name, value.trim());
      }
    } catch (error) {
      // الألوان الافتراضية تكفي
    }
  }, [host]);
  return [host, anchor, syncVars];
}

// ── Modal ────────────────────────────────────────────────────
export function Modal({ title, onClose, children, footer = null, closeLabel = 'إغلاق', className = '' }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  const [host, anchor, syncVars] = useDialogHost();
  // الإغلاق يمرّ بحالة is-closing (خروج قصير) ثم يستدعي onClose؛ صفر مهلة تحت تقليل الحركة.
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const requestClose = () => {
    if (!onClose || closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    setTimeout(() => { closingRef.current = false; setClosing(false); onClose(); }, wait(180));
  };
  useEffect(() => { closeRef.current = requestClose; });
  // عند الفتح فقط: كل تصيير يمرّر onClose جديدة، فلو اعتمد التأثير عليها لسُحب
  // التركيز من الحقل بعد كل حرف يُكتب.
  useEffect(() => {
    const node = ref.current;
    const previous = document.activeElement;
    syncVars();
    const restore = deactivateBackground(host);
    focusFirst(node);
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current && closeRef.current(); }
      else if (e.key === 'Tab') trapTab(node, e);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      restore();
      if (previous && previous.focus) previous.focus();
    };
  }, [host, syncVars]);
  const tree = (
    <div className={`modal-layer ${closing ? 'is-closing' : ''}`} role="presentation" onClick={requestClose}>
      <section ref={ref} className={`modal ${className}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          {onClose && <IconButton label={closeLabel} onClick={requestClose}><IconClose /></IconButton>}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </section>
    </div>
  );
  return <><span ref={anchor} hidden aria-hidden="true" />{host ? createPortal(tree, host) : tree}</>;
}

export function ConfirmModal({ title, message, confirmLabel = 'نعم', cancelLabel = 'لا', danger = false, onConfirm, onCancel }) {
  return (
    <Modal title={title} onClose={onCancel} className={danger ? 'is-danger' : ''} footer={<>
      <Button variant={danger ? 'danger' : 'primary'} size="lg" full onClick={onConfirm}>{confirmLabel}</Button>
      <Button variant="ghost" full onClick={onCancel}>{cancelLabel}</Button>
    </>}>
      <p className="muted" style={{ lineHeight: 1.7 }}>{message}</p>
    </Modal>
  );
}

// ── Sheet (bottom sheet, drag down to close) ─────────────────
export function Sheet({ open, onClose, title, children }) {
  const [closing, setClosing] = useState(false);
  const drag = useRef({ y: 0, dy: 0, active: false });
  const ref = useRef(null);
  const [host, anchor, syncVars] = useDialogHost();
  const close = useCallback(() => {
    setClosing(true);
    setTimeout(() => { setClosing(false); onClose && onClose(); }, wait(210));
  }, [onClose]);
  const closeRef = useRef(close);
  useEffect(() => { closeRef.current = close; });
  useEffect(() => {
    if (!open) return undefined;
    const node = ref.current;
    const previous = document.activeElement;
    syncVars();
    const restore = deactivateBackground(host);
    focusFirst(node);
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); }
      else if (e.key === 'Tab') trapTab(node, e);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      restore();
      if (previous && previous.focus) previous.focus();
    };
  }, [open, host, syncVars]);
  if (!open) return null;
  const onStart = (e) => { drag.current = { y: e.touches ? e.touches[0].clientY : e.clientY, dy: 0, active: ref.current.scrollTop <= 0 }; };
  const onMove = (e) => {
    if (!drag.current.active) return;
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    drag.current.dy = Math.max(0, y - drag.current.y);
    if (ref.current) ref.current.style.transform = `translateY(${drag.current.dy}px)`;
  };
  const onEnd = () => {
    if (!drag.current.active) return;
    if (ref.current) ref.current.style.transform = '';
    if (drag.current.dy > 80) close();
    drag.current.active = false;
  };
  const tree = (
    <div className="modal-layer is-sheet" role="presentation" onClick={close}>
      <section ref={ref} className={`sheet ${closing ? 'is-closing' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd}>
        <div className="sheet-handle" aria-hidden="true" />
        {title && <div className="modal-head"><h2>{title}</h2><IconButton label="إغلاق" onClick={close}><IconClose /></IconButton></div>}
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
  return <><span ref={anchor} hidden aria-hidden="true" />{host ? createPortal(tree, host) : tree}</>;
}

// ── ErrorBoundary ────────────────────────────────────────────
// خطأ تصيير في أي لعبة كان يُفرغ الصفحة كلها بلا رجعة. الحدّ هنا يعرض رسالة
// عربية مع «العودة إلى الرئيسية» وزر مسح البيانات المحفوظة (سبب الأعطال
// المتكررة عادة)، فلا تُسقط لعبة واحدة المنصة كلها.
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.reset = this.reset.bind(this);
  }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    try { console.error('[ميدان] خطأ في التصيير:', error, info && info.componentStack); } catch (e) { /* ignore */ }
  }
  componentDidUpdate(previous) {
    // تغيّر المسار (أو أي مفتاح يمرّره المستدعي) يعيد المحاولة تلقائيًا.
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.reset();
  }
  reset() { this.setState({ error: null }); }
  render() {
    const { error } = this.state;
    const { children, fallback, title = 'تعطّلت هذه الشاشة', message = 'حدث خطأ غير متوقع. يمكنك العودة إلى الرئيسية، أو مسح البيانات المحفوظة إن تكرّر الخطأ.', homeLabel = 'العودة إلى الرئيسية', clearLabel = 'مسح البيانات المحفوظة', onHome, onClear } = this.props;
    if (!error) return children;
    if (typeof fallback === 'function') return fallback(error, this.reset);
    return (
      <div className="error-boundary" role="alert">
        <div className="error-card">
          <h2>{title}</h2>
          <p className="muted">{message}</p>
          <p className="error-detail">{String((error && error.message) || error)}</p>
          <Button variant="primary" size="lg" full onClick={() => { if (onHome) onHome(); this.reset(); }}>{homeLabel}</Button>
          {onClear && <Button variant="danger" full onClick={() => { onClear(); }}>{clearLabel}</Button>}
        </div>
      </div>
    );
  }
}

// ── Toast ────────────────────────────────────────────────────
const ToastContext = createContext(() => {});
export function useToast() { return useContext(ToastContext); }
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const toast = useCallback((message, { kind = '', duration = 2400 } = {}) => {
    const id = Date.now() + Math.random();
    setItems((list) => [...list.slice(-2), { id, message, kind }]);
    // خروج قصير (is-leaving) قبل الإزالة؛ تحت تقليل الحركة يتزامنان.
    setTimeout(() => setItems((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t))), Math.max(0, duration - wait(200)));
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), duration);
  }, []);
  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toast-host" aria-live="polite">
        {items.map((t) => <div key={t.id} className={`toast ${t.kind ? `is-${t.kind}` : ''} ${t.leaving ? 'is-leaving' : ''}`} role="status">{t.message}</div>)}
      </div>
    </ToastContext.Provider>
  );
}

// ── ProgressRing ─────────────────────────────────────────────
export function ProgressRing({ value, max = 1, size = 132, stroke = 10, color = 'var(--accent)', children }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const fraction = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="ring-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" />
        <circle className="ring-bar" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" stroke={color}
          strokeDasharray={c} strokeDashoffset={c * (1 - fraction)} />
      </svg>
      <div className="ring-label">{children}</div>
    </div>
  );
}

// ── Scoreboard ───────────────────────────────────────────────
// النقاط تُعدّ من القيمة السابقة (مرجع يحفظ آخر نقاط كل صف) وتُلكم عند التغيّر؛ +N يطير للأعلى.
export function Scoreboard({ entries, unit = '' }) {
  const max = Math.max(...entries.map((e) => e.score), -Infinity);
  const prev = useRef(new Map());
  const bumps = useRef(new Map());
  useEffect(() => { entries.forEach((e) => prev.current.set(e.id, e.score)); });
  const now = Date.now();
  return (
    <div className="scoreboard">
      {entries.map((e, i) => {
        const from = prev.current.get(e.id) ?? e.score;
        if (from !== e.score) bumps.current.set(e.id, now);
        const bumped = (bumps.current.get(e.id) || 0) > now - 600;
        return (
          <div key={e.id} className={`score-row ${e.score === max && max > 0 ? 'is-leader' : ''}`} style={{ '--row-color': e.color, '--n': i }}>
            <ClayStage className="clay-static no-contact"><Avatar player={e} className="avatar" /></ClayStage>
            <span className="name">{e.name}</span>
            {e.delta ? <span className="delta" key={`${e.score}-${e.delta}`}>+{e.delta}</span> : null}
            <span className={`score ${bumped ? 'is-bumped' : ''}`} key={e.score}><CountUp value={e.score} from={from} duration={600} />{unit}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── count-up number ──────────────────────────────────────────
// from: نقطة البداية (0 افتراضًا)، delay: تأخير قبل العدّ؛ تحت تقليل الحركة يقفز للقيمة فورًا.
export function CountUp({ value, from = 0, duration = 900, delay = 0, className = '' }) {
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? value : from));
  const current = useRef(prefersReducedMotion() ? value : from); // آخر رقم معروض: تغيّر القيمة لاحقًا يعدّ منه لا من from
  useEffect(() => {
    const base = current.current;
    const show = (n) => { current.current = n; setShown(n); };
    if (prefersReducedMotion() || base === value) { show(value); return undefined; }
    let raf = 0;
    let start = 0;
    const step = (now) => {
      if (!start) start = now;
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      show(Math.round(base + (value - base) * eased));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    const timer = setTimeout(() => { raf = requestAnimationFrame(step); }, wait(delay));
    return () => { clearTimeout(timer); cancelAnimationFrame(raf); };
  }, [value, duration, delay]);
  return <span className={`count-up ${className}`}>{shown}</span>;
}

// ── Podium ───────────────────────────────────────────────────
export function Podium({ entries, title, unit = '' }) {
  const sorted = [...entries].sort((a, b) => b.score - a.score);
  const top = sorted.slice(0, 3);
  const rest = sorted.slice(3);
  const order = top.length === 3 ? [top[1], top[0], top[2]] : top.length === 2 ? [top[1], top[0]] : top;
  const heights = { 0: 92, 1: 66, 2: 48 };
  const winners = sorted.filter((e) => e.score === sorted[0].score);
  const heading = title || (winners.length > 1 ? 'تعادل جميل!' : `فاز ${sorted[0].name}`);
  // التسلسل: الأعمدة تصعد 3→2→1 (الفائز آخرًا)، ثم دفعة قصاصات صغيرة عند عمود الفائز (~1.1s).
  const winnerRef = useRef(null);
  useEffect(() => {
    const t = setTimeout(() => {
      const r = winnerRef.current?.getBoundingClientRect();
      if (r) burstConfetti({ x: r.left + r.width / 2, y: r.top + 20, count: 40 });
    }, wait(1100));
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="podium">
      <div className="podium-trophy clay-stage clay-idle" aria-hidden="true"><span className="clay-lift"><TrophyArtwork /></span></div>
      <h1 className="podium-title">{heading}</h1>
      <div className="podium-stage">
        {order.map((e) => {
          const rank = sorted.indexOf(e);
          return (
            <div key={e.id} ref={rank === 0 ? winnerRef : null} data-rank={sorted.findIndex((entry) => entry.score === e.score) + 1} className="podium-col" style={{ '--col-color': e.color, '--delay': `${(2 - rank) * 260 + 300}ms`, '--h': `${heights[rank]}px` }}>
              <ClayStage className="avatar-wrap"><Avatar player={e} className="avatar" /></ClayStage>
              <span className="name">{e.name}</span>
              <div className="block"><span className="rank" aria-label="الترتيب">{sorted.findIndex((entry) => entry.score === e.score) + 1}</span><span><CountUp value={e.score} delay={(2 - rank) * 260 + 600} />{unit}</span></div>
            </div>
          );
        })}
      </div>
      {rest.length > 0 && <div className="podium-rest"><Scoreboard entries={rest} unit={unit} /></div>}
    </div>
  );
}

// ── Screen ───────────────────────────────────────────────────
export function Screen({ dir = 'forward', className = '', children, ...rest }) {
  return <section className={`screen ${className}`} data-dir={dir} {...rest}>{children}</section>;
}

export function TopBar({ title, eyebrow, start = null, end = null }) {
  return (
    <header className="topbar">
      {start}
      <h1>{eyebrow && <span className="eyebrow">{eyebrow}</span>}{title}</h1>
      {end}
    </header>
  );
}

export function Segment({ options, value, onChange, accent = false, label }) {
  return (
    <div className="segment" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" className={`${value === o.value ? 'selected' : ''} ${accent ? 'accent' : ''}`} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

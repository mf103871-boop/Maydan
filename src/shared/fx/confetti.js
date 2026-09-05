// قصاصات ملونة على canvas خاص بنا — بلا مكتبة. تحترم «تقليل الحركة».
const DEFAULT_COLORS = ['#F5B82E', '#FF4D4D', '#2ED8A3', '#4DA3FF', '#B57BFF', '#FF5C8A', '#FFFFFF'];

function reducedMotion() {
  try {
    if (typeof document !== 'undefined' && document.documentElement.dataset.reducedMotion === 'true') return true;
    return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (error) {
    return false;
  }
}

let canvas = null;
let ctx = null;
let particles = [];
let raf = 0;
let lastTime = 0;

function ensureCanvas() {
  if (canvas) return;
  canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'fixed',
    inset: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    zIndex: '900',
  });
  document.body.appendChild(canvas);
  ctx = canvas.getContext('2d');
  resize();
  window.addEventListener('resize', resize);
}

function resize() {
  if (!canvas) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function frame(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000 || 0.016);
  lastTime = now;
  const w = window.innerWidth;
  const h = window.innerHeight;
  ctx.clearRect(0, 0, w, h);
  particles = particles.filter((p) => p.life > 0 && p.y < h + 40);
  for (const p of particles) {
    p.vy += 900 * dt * p.gravity;
    p.vx *= 1 - 0.9 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.spin * dt;
    p.life -= dt;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life / 0.6));
    ctx.fillStyle = p.color;
    if (p.shape === 'circle') {
      ctx.beginPath();
      ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
    }
    ctx.restore();
  }
  if (particles.length) raf = requestAnimationFrame(frame);
  else {
    raf = 0;
    ctx.clearRect(0, 0, w, h);
  }
}

function spawn({ count, x, y, spread, power, colors, gravity, life }) {
  for (let i = 0; i < count; i += 1) {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * spread;
    const speed = power * (0.5 + Math.random() * 0.8);
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      rot: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 12,
      size: 6 + Math.random() * 8,
      color: colors[Math.floor(Math.random() * colors.length)],
      shape: Math.random() < 0.3 ? 'circle' : 'rect',
      gravity,
      life: life * (0.7 + Math.random() * 0.6),
    });
  }
  if (particles.length > 900) particles = particles.slice(-900);
  if (!raf) {
    lastTime = performance.now();
    raf = requestAnimationFrame(frame);
  }
}

// انفجار كبير من الأسفل (نهاية الجولة / الفائز).
export function fireConfetti({ count = 160, colors = DEFAULT_COLORS, duration = 2.6 } = {}) {
  if (typeof document === 'undefined' || reducedMotion()) return;
  ensureCanvas();
  const w = window.innerWidth;
  const h = window.innerHeight;
  spawn({ count: Math.ceil(count / 2), x: w * 0.2, y: h * 0.95, spread: 1.1, power: 900, colors, gravity: 1, life: duration });
  spawn({ count: Math.ceil(count / 2), x: w * 0.8, y: h * 0.95, spread: 1.1, power: 900, colors, gravity: 1, life: duration });
}

// دفعة صغيرة من نقطة (إجابة صحيحة).
export function burstConfetti({ x, y, count = 28, colors = DEFAULT_COLORS } = {}) {
  if (typeof document === 'undefined' || reducedMotion()) return;
  ensureCanvas();
  spawn({
    count,
    x: x ?? window.innerWidth / 2,
    y: y ?? window.innerHeight * 0.45,
    spread: Math.PI * 2,
    power: 420,
    colors,
    gravity: 0.9,
    life: 1.2,
  });
}

export function clearConfetti() {
  particles = [];
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  if (ctx) ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
}

export const confetti = { fire: fireConfetti, burst: burstConfetti, clear: clearConfetti };

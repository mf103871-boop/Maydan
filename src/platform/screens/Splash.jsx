// شاشة الافتتاح: شعار بقناع كشف + جسيمات canvas خفيفة (≤ 200)، 1.8 ثانية مع تخطٍّ باللمس.
import React, { useEffect, useRef, useState } from 'react';

export function Splash({ onDone, duration = 1800 }) {
  const canvasRef = useRef(null);
  const [leaving, setLeaving] = useState(false);
  const doneRef = useRef(false);

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    setLeaving(true);
    setTimeout(onDone, 330);
  };

  useEffect(() => {
    const reduced = document.documentElement.dataset.reducedMotion === 'true' || (matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    const timer = setTimeout(finish, reduced ? 600 : duration);
    const canvas = canvasRef.current;
    if (!canvas || reduced) return () => clearTimeout(timer);
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    const count = Math.min(200, Math.floor((w * h) / 4500));
    const particles = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: 0.6 + Math.random() * 1.8,
      vx: (Math.random() - 0.5) * 12,
      vy: -8 - Math.random() * 22,
      a: 0.2 + Math.random() * 0.6,
      gold: Math.random() < 0.6,
    }));
    let raf = 0;
    let last = performance.now();
    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.y < -10) { p.y = h + 10; p.x = Math.random() * w; }
        ctx.globalAlpha = p.a;
        ctx.fillStyle = p.gold ? '#F5B82E' : '#4DA3FF';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { clearTimeout(timer); cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`splash ${leaving ? 'is-leaving' : ''}`} onClick={finish} role="button" tabIndex={0} aria-label="تخطي شاشة البداية" onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && finish()}>
      <canvas ref={canvasRef} aria-hidden="true" />
      <div className="splash-inner">
        <div className="splash-mark" aria-hidden="true">م</div>
        <div className="splash-title">منصة ميدان</div>
        <div className="splash-sub">ألعاب جماعية على جهاز واحد</div>
      </div>
      <div className="splash-skip">المس الشاشة للتخطي</div>
    </div>
  );
}

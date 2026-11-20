// Two canvas layers let the beads pass behind the lamp and in front of its base.
export function startOrbit(board) {
  const scene = board.querySelector('.opening-scene');
  const layers = ['opening-orbit-back', 'opening-orbit-front'].map(id => document.getElementById(id).getContext('2d'));
  if (layers.some(context => !context)) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const beads = [
    { angle: .68, size: 7, colors: ['#ffe5c3', '#ffac89', '#d67163'], form: 'round' },
    { angle: 3.27, size: 8, colors: ['#f1d9ff', '#b895d5', '#8a63aa'], form: 'tile' },
    { angle: 5.55, size: 6, colors: ['#fff1a0', '#f4c65d', '#db9b41'], form: 'tile' },
  ];
  const sparks = [[.12,.37,4],[.84,.66,4.8],[.69,.13,3],[.29,.72,2.6],[.88,.31,2],[.21,.20,2]];
  let width = 1, height = 1, frame = 0, elapsed = 0, lastTime;
  const direction = -.22;
  function orbit(angle) {
    const x = Math.cos(angle) * width * .422;
    const y = Math.sin(angle) * height * .121;
    return [width * .5 + x * Math.cos(direction) - y * Math.sin(direction),
      height * .485 + x * Math.sin(direction) + y * Math.cos(direction)];
  }
  function arc(context, from, until, color, weight) {
    context.beginPath();
    for (let i = 0; i <= 52; i++) {
      const [x,y] = orbit(from + (until - from) * i / 52);
      if (i === 0) context.moveTo(x,y); else context.lineTo(x,y);
    }
    context.lineWidth = weight; context.strokeStyle = color; context.stroke();
  }
  function draw(time) {
    const [back, front] = layers;
    for (const layer of layers) layer.clearRect(0, 0, width, height);
    arc(back, Math.PI, 2*Math.PI, '#cdac9073', .9);
    arc(front, 0, Math.PI, '#d3a88169', 2.4);
    arc(front, 0, Math.PI, '#fffbef', 1.2);
    for (const bead of beads) {
      const angle = bead.angle + time * .63;
      const depth = Math.sin(angle);
      const context = depth < 0 ? back : front;
      const [x,y] = orbit(angle);
      const radius = bead.size * (1 + depth * .15) * Math.min(1.15,width/350);
      context.save();
      context.translate(x,y); context.rotate(angle * .65);
      const paint = context.createRadialGradient(-radius*.38,-radius*.46,.4,0,0,radius*1.32);
      bead.colors.forEach((color,i) => paint.addColorStop(i/2,color));
      context.fillStyle = paint;
      context.shadowColor = '#98653d35'; context.shadowBlur = 3; context.shadowOffsetY = 1.6;
      context.beginPath();
      if (bead.form === 'round') context.arc(0,0,radius,0,2*Math.PI);
      else if (!context.roundRect) context.rect(-radius,-radius,radius*2,radius*2);
      else context.roundRect(-radius,-radius,radius*2,radius*2,radius*.55);
      context.fill(); context.restore();
    }
    for (const [i, [x,y,radius]] of sparks.entries()) {
      const pulse = (1 + Math.sin(time * 1.55 + i * 1.7)) / 2;
      const r = radius * (.68 + pulse * .6);
      back.save(); back.translate(width*x,height*y+Math.sin(time*.55+i)*2);
      back.globalAlpha = .29 + pulse*.56; back.fillStyle = i%2 ? '#d7a054' : '#e6b164';
      back.beginPath();back.moveTo(0,-r);back.quadraticCurveTo(.12*r,-.12*r,r,0);
      back.quadraticCurveTo(.12*r,.12*r,0,r);back.quadraticCurveTo(-.12*r,.12*r,-r,0);
      back.quadraticCurveTo(-.12*r,-.12*r,0,-r);back.fill();back.restore();
    }
  }
  function tick(now) {
    if (lastTime !== undefined) elapsed += Math.min((now-lastTime)/1000,.08);
    lastTime=now; draw(elapsed); frame=requestAnimationFrame(tick);
  }
  function redraw() {
    cancelAnimationFrame(frame); lastTime=undefined;
    const bounds=scene.getBoundingClientRect();width=bounds.width; height=bounds.height;
    const dpr = Math.min(devicePixelRatio||1,2);
    for (const context of layers) {
      context.canvas.width=Math.round(width*dpr);context.canvas.height=Math.round(height*dpr);
      context.setTransform(dpr,0,0,dpr,0,0);
    }
    draw(elapsed);
    if (!document.hidden && !reduced.matches && board.dataset.reduce !== 'true')
      frame=requestAnimationFrame(tick);
  }
  const observer = new ResizeObserver(redraw);
  observer.observe(scene);
  const modern = typeof reduced.addEventListener === 'function';
  if (modern) reduced.addEventListener('change',redraw); else reduced.addListener(redraw);
  document.addEventListener('visibilitychange',redraw);
  redraw();
  return () => {
    observer.disconnect();
    cancelAnimationFrame(frame);
    if (modern) reduced.removeEventListener('change',redraw); else reduced.removeListener(redraw);
    document.removeEventListener('visibilitychange',redraw);
  };
}

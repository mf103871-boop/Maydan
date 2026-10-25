const clamp = (n,min,max) => Math.max(min,Math.min(max,n));
export function designRect(layout, container, natural, { required = false, square = false, interactive = false } = {}) {
  const min = interactive || required ? 44 : 1;
  const width = Math.min(container.width, square ? container.height : Infinity, Math.max(min, layout.width == null ? natural.width : container.width * layout.width));
  const height = square ? width : Math.min(container.height,Math.max(min, layout.height == null || layout.height === 'auto' ? natural.height : container.height * layout.height));
  const anchorX = { left:0, center:.5, right:1 }[layout.anchorX || 'left'];
  const anchorY = { top:0, center:.5, bottom:1 }[layout.anchorY || 'top'];
  const x = layout.x == null ? natural.x : container.width * layout.x - width * anchorX;
  const y = layout.y == null ? natural.y : container.height * layout.y - height * anchorY;
  return { x: clamp(x,0,Math.max(0,container.width-width)), y: clamp(y,0,Math.max(0,container.height-height)), width, height, z: layout.z || 0 };
}
export function layoutFromRect(rect, container) { return { x: rect.x/container.width,y:rect.y/container.height,width:rect.width/container.width,height:rect.height/container.height,anchorX:'left',anchorY:'top',z:0 }; }
export function contrastRatio(a,b) {
  function lum(hex) { const raw=hex.replace('#',''); const full=raw.length===3?[...raw].map(x=>x+x).join(''):raw.slice(0,6); const rgb=[0,2,4].map(i=>parseInt(full.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4); return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2]; }
  const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}

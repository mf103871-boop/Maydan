import { DESIGN_REGISTRY_VERSION, getScreenDefinition, getNodeDefinition } from './registry.js';
import { contrastRatio } from './geometry.js';

export const DESIGN_SCHEMA_VERSION = 1;
export const DESIGN_PROFILES = ['portrait', 'landscape', 'large'];
export const TOKEN_FIELDS = ['--bg','--bg-2','--surface','--surface-2','--stroke','--text','--muted','--accent','--accent-ink','--purple','--gold','--danger','--success','--radius','--radius-sm','--font'];
export const STYLE_FIELDS = ['backgroundColor','color','borderColor','borderWidth','borderRadius','boxShadow','opacity','fontSize','fontFamily','padding','gap'];
export const DESIGN_LIMITS = { bytes: 524288, assets: 200, decorationsPerScreen: 32, text: 400, nodes: 3000 };
const COLOR = /^#(?:[a-f\d]{3}|[a-f\d]{6})$/i;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/;
const FONTS = ['maydan','system'];
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const finite = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const safeKeys = value => Object.keys(value).every(key => !['__proto__','prototype','constructor'].includes(key));
export function createDefaultDesign() { return { schemaVersion: 1, registryVersion: DESIGN_REGISTRY_VERSION, tokens: {}, screens: {}, assets: [] }; }
export const defaultDesignDocument = createDefaultDesign;
export function designProfile(width, height) { return Math.min(width, height) < 620 ? (width > height ? 'landscape' : 'portrait') : 'large'; }
export function validateDesignDocument(input) {
  const errors = []; let count = 0;
  const error = (path, message) => errors.push({ path, message });
  function keys(value, allowed, path) { if (!plain(value) || !safeKeys(value)) { error(path, 'كائن غير صالح'); return false; } for (const key of Object.keys(value)) if (!allowed.includes(key)) error(`${path}.${key}`, 'خاصية غير مدعومة'); return true; }
  function text(value, path, max = 400) { if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) error(path, 'نص غير صالح'); }
  function style(value, path, required) {
    if (!keys(value, STYLE_FIELDS, path)) return;
    for (const [key, item] of Object.entries(value)) {
      if (['backgroundColor','color','borderColor'].includes(key)) { if (typeof item !== 'string' || !COLOR.test(item)) error(`${path}.${key}`, 'لون غير صالح'); }
      else if (key === 'fontFamily') { if (!FONTS.includes(item)) error(`${path}.${key}`, 'خط غير مدعوم'); }
      else if (key === 'boxShadow') { if (!['none','soft','raised'].includes(item)) error(`${path}.${key}`, 'ظل غير مدعوم'); }
      else if (!finite(item, key === 'opacity' ? (required ? .75 : 0) : key === 'fontSize' ? 12 : 0, key === 'opacity' ? 1 : key === 'fontSize' ? 64 : key === 'borderWidth' ? 12 : 200)) error(`${path}.${key}`, 'قيمة خارج الحدود');
    }
    if (required && typeof value.color === 'string' && typeof value.backgroundColor === 'string' && COLOR.test(value.color) && COLOR.test(value.backgroundColor) && contrastRatio(value.color,value.backgroundColor)<4.5) error(path,'تباين العنصر المطلوب غير كافٍ');
  }
  if (plain(input) && plain(input.tokens)) {
    const ink=input.tokens['--text'] || '#352547',bg=input.tokens['--bg'] || '#FFF7E7';
    if(typeof ink==='string' && typeof bg==='string' && COLOR.test(ink) && COLOR.test(bg) && contrastRatio(ink,bg)<4.5) error('tokens','تباين النص والخلفية غير كافٍ');
  }
  function layouts(value, path, repeat=false) {
    if (!keys(value, DESIGN_PROFILES, path)) return;
    for (const [profile, layout] of Object.entries(value)) {
      const at = `${path}.${profile}`;
      if (!keys(layout, ['x','y','width','height','anchorX','anchorY','z','group'], at)) continue;
      for (const key of ['x','y']) if (key in layout && !finite(layout[key], repeat ? -1 : 0, 1)) error(`${at}.${key}`, 'موضع خارج الشاشة');
      if ('width' in layout && !finite(layout.width, .02, 1)) error(`${at}.width`, 'عرض غير صالح');
      if ('height' in layout && layout.height !== 'auto' && !finite(layout.height, .02, 1)) error(`${at}.height`, 'ارتفاع غير صالح');
      if ('anchorX' in layout && !['left','center','right'].includes(layout.anchorX)) error(`${at}.anchorX`, 'مرساة غير صالحة');
      if ('anchorY' in layout && !['top','center','bottom'].includes(layout.anchorY)) error(`${at}.anchorY`, 'مرساة غير صالحة');
      if ('z' in layout && (!Number.isInteger(layout.z) || !finite(layout.z, 0, 40))) error(`${at}.z`, 'طبقة غير صالحة');
      if ('group' in layout) text(layout.group, `${at}.group`, 40);
    }
  }
  if (!keys(input, ['schemaVersion','registryVersion','tokens','screens','assets'], '$')) return { ok: false, errors, document: null };
  if (input.schemaVersion !== 1 || input.registryVersion !== DESIGN_REGISTRY_VERSION) error('$', 'إصدار التصميم غير متوافق');
  try { if (new TextEncoder().encode(JSON.stringify(input)).length > DESIGN_LIMITS.bytes) error('$', 'التصميم أكبر من الحد'); } catch { error('$', 'تعذر قراءة التصميم'); }
  if (!plain(input.tokens) || !safeKeys(input.tokens)) error('tokens', 'رموز غير صالحة');
  else for (const [key,value] of Object.entries(input.tokens)) {
    if (!TOKEN_FIELDS.includes(key)) error(`tokens.${key}`, 'رمز غير مدعوم');
    else if (key === '--font') { if (!FONTS.includes(value)) error(`tokens.${key}`, 'خط غير مدعوم'); }
    else if (['--radius','--radius-sm'].includes(key)) { if (!finite(value, 0, 80)) error(`tokens.${key}`, 'استدارة غير صالحة'); }
    else if (typeof value !== 'string' || !COLOR.test(value)) error(`tokens.${key}`, 'لون غير صالح');
  }
  if (!Array.isArray(input.assets) || input.assets.length > DESIGN_LIMITS.assets || input.assets.some(id => typeof id !== 'string' || !ID.test(id)) || new Set(input.assets).size !== input.assets.length) error('assets', 'ملفات غير صالحة');
  if (!plain(input.screens) || !safeKeys(input.screens)) error('screens', 'شاشات غير صالحة');
  else for (const [screenId,screen] of Object.entries(input.screens)) {
    const at = `screens.${screenId}`;
    if (!getScreenDefinition(screenId)) { error(at, 'شاشة غير معروفة'); continue; }
    if (!keys(screen, ['nodes','decorations'], at)) continue;
    if (screen.nodes != null) {
      if (!plain(screen.nodes) || !safeKeys(screen.nodes)) error(`${at}.nodes`, 'عناصر غير صالحة');
      else for (const [nodeId,node] of Object.entries(screen.nodes)) {
        if (++count > DESIGN_LIMITS.nodes) { error(at, 'عناصر أكثر من الحد'); break; }
        const def = getNodeDefinition(screenId,nodeId); const path = `${at}.nodes.${nodeId}`;
        if (!def) { error(path, 'عنصر غير معروف'); continue; }
        if (!keys(node, ['visible','text','icon','style','layouts'], path)) continue;
        if ('visible' in node && (typeof node.visible !== 'boolean' || (def.required && !node.visible))) error(`${path}.visible`, 'هذا العنصر مطلوب');
        if ('text' in node) { text(node.text, `${path}.text`); if(def.editableText===false)error(`${path}.text`,'محتوى هذا العنصر يتبع بيانات اللعبة'); if(def.required && typeof node.text==='string' && !node.text.trim())error(`${path}.text`,'العنصر المطلوب يحتاج تسمية واضحة'); }
        if ('icon' in node && !['games','friends','store','settings','star','play','back','mic','none'].includes(node.icon)) error(`${path}.icon`, 'أيقونة غير مدعومة');
        if ('icon' in node && def.editableIcon===false)error(`${path}.icon`,'أيقونة هذا العنصر تتبع حالته');
        if (node.style != null) style(node.style, `${path}.style`, !!def.required);
        if (plain(node.style) && def.editableStyle && Object.keys(node.style).some(key=>!def.editableStyle.includes(key)))error(`${path}.style`,'هذه الخاصية تعبّر عن وظيفة العنصر');
        if (plain(node.style) && def.kind==='input' && node.style.fontSize!=null && node.style.fontSize<16)error(`${path}.style.fontSize`,'خط حقول الكتابة يجب ألا يقل عن 16 بكسل');
        if (node.layouts != null) layouts(node.layouts, `${path}.layouts`, !!def.repeat);
      }
    }
    if (screen.decorations != null) {
      if (!Array.isArray(screen.decorations) || screen.decorations.length > DESIGN_LIMITS.decorationsPerScreen) error(`${at}.decorations`, 'إضافات غير صالحة');
      else {
        const seen = new Set();
        for (const [index,dec] of screen.decorations.entries()) {
          const path = `${at}.decorations.${index}`;
          if (!keys(dec, ['id','type','text','assetId','shape','visible','style','layouts'], path)) continue;
          if (typeof dec.id !== 'string' || !ID.test(dec.id) || seen.has(dec.id)) error(`${path}.id`, 'معرف غير صالح'); seen.add(dec.id);
          if (!['text','image','shape'].includes(dec.type)) error(`${path}.type`, 'إضافة غير مدعومة');
          if ('visible' in dec && typeof dec.visible !== 'boolean') error(`${path}.visible`, 'ظهور غير صالح');
          if (dec.type === 'text') text(dec.text, `${path}.text`);
          if (dec.type === 'image' && (!Array.isArray(input.assets) || !input.assets.includes(dec.assetId))) error(`${path}.assetId`, 'ملف غير مرفق');
          if (dec.shape != null && !['rect','circle'].includes(dec.shape)) error(`${path}.shape`, 'شكل غير صالح');
          if (dec.style != null) style(dec.style, `${path}.style`, false);
          if (dec.layouts != null) layouts(dec.layouts, `${path}.layouts`);
        }
      }
    }
  }
  return { ok: !errors.length, errors, document: errors.length ? null : JSON.parse(JSON.stringify(input)) };
}

export function nodeStyle(style = {}) {
  const output = { ...style };
  if (style.boxShadow != null) output.boxShadow = { none:'none',soft:'0 4px 12px #35254718',raised:'0 12px 28px #35254730' }[style.boxShadow];
  if (style.fontFamily) output.fontFamily = style.fontFamily === 'system' ? 'system-ui, sans-serif' : '"Maydan Round", system-ui, sans-serif';
  return output;
}
export function tokenStyle(tokens = {}) { return Object.fromEntries(Object.entries(tokens).map(([key,value]) => [key,key === '--font' ? (value === 'system' ? 'system-ui, sans-serif' : '"Maydan Round", system-ui, sans-serif') : key.includes('radius') ? `${value}px` : value])); }

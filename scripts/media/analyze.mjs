// فحص الصور بحسب المؤثّر الذي ستُلعب به: المؤثّر هو اللغز، فإن لم تحتمله الصورة
// صار السؤال بلا حل. هذه الدوال تقيس ذلك قبل أن يدخل السؤال البنك.
import sharp from 'sharp';

const ZOOM_SCALE = 3.4;          // يطابق .m-media-img.fx-zoom في styles.css
const PROBE_WIDTH = 240;         // دقة التحليل: تكفي للتمييز وتبقى سريعة

async function gray(file) {
  const image = sharp(file).flatten({ background: '#ffffff' }).resize({ width: PROBE_WIDTH, fit: 'inside', withoutEnlargement: false }).greyscale();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

// شدة الحافة لكل بكسل: |dx| + |dy|. التفاصيل الغنية = حواف كثيرة = قصّة مقروءة.
function edges({ data, width, height }) {
  const out = new Float64Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      out[i] = Math.abs(data[i + 1] - data[i - 1]) + Math.abs(data[i + width] - data[i - width]);
    }
  }
  return out;
}

function integral(values, width, height) {
  const sum = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += values[y * width + x];
      sum[(y + 1) * (width + 1) + (x + 1)] = sum[y * (width + 1) + (x + 1)] + row;
    }
  }
  return sum;
}

const boxSum = (sum, width, x0, y0, x1, y1) => sum[y1 * (width + 1) + x1] - sum[y0 * (width + 1) + x1] - sum[y1 * (width + 1) + x0] + sum[y0 * (width + 1) + x0];

// أفضل نقطة تقريب: مركز النافذة التي تحوي أكثر التفاصيل. النسخة القديمة كانت تختار
// النقطة عشوائيًا فوقعت على سماء فارغة في أغلب الأسئلة.
export async function bestZoomOrigin(file) {
  const probe = await gray(file);
  const { width, height } = probe;
  const map = edges(probe);
  const sum = integral(map, width, height);
  const boxW = Math.max(4, Math.round(width / ZOOM_SCALE));
  const boxH = Math.max(4, Math.round(height / ZOOM_SCALE));
  const step = Math.max(1, Math.round(Math.min(boxW, boxH) / 6));
  const area = boxW * boxH;
  let best = { score: -1, x: 0, y: 0 };
  for (let y = 0; y + boxH <= height; y += step) {
    for (let x = 0; x + boxW <= width; x += step) {
      // انحياز خفيف إلى الوسط: التفاصيل الطرفية كثيرًا ما تكون خلفية لا موضوعًا.
      const cx = (x + boxW / 2) / width; const cy = (y + boxH / 2) / height;
      const bias = 1 - 0.25 * (Math.abs(cx - 0.5) + Math.abs(cy - 0.5));
      const score = (boxSum(sum, width, x, y, x + boxW, y + boxH) / area) * bias;
      if (score > best.score) best = { score, x, y };
    }
  }
  const whole = boxSum(sum, width, 0, 0, width, height) / (width * height);
  const originX = Math.round(((best.x + boxW / 2) / width) * 100);
  const originY = Math.round(((best.y + boxH / 2) / height) * 100);
  return {
    origin: `${originX}% ${originY}%`,
    detail: Number(best.score.toFixed(2)),      // متوسط شدة الحافة داخل القصّة
    ratio: Number((best.score / (whole || 1)).toFixed(2)), // كم تفوق القصّة متوسط الصورة
  };
}

// الظل: المؤثّر يصبغ الصورة بالأسود، فالصورة المعتمة بلا شفافية تتحول مستطيلًا أسود
// لا شكل فيه. الشرط: قناة ألفا، وتغطية معقولة، وحدود خارجية شبه فارغة.
export async function silhouetteCheck(file) {
  const meta = await sharp(file).metadata();
  if (!meta.hasAlpha) return { ok: false, reason: 'بلا قناة شفافية: الظل يصير مستطيلًا أسود' };
  const width = 160;
  const { data, info } = await sharp(file).resize({ width, fit: 'inside' }).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
  const total = info.width * info.height;
  let opaque = 0; let border = 0; let borderTotal = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const on = data[y * info.width + x] > 128;
      if (on) opaque++;
      const isBorder = x < 2 || y < 2 || x >= info.width - 2 || y >= info.height - 2;
      if (isBorder) { borderTotal++; if (on) border++; }
    }
  }
  const coverage = opaque / total;
  const borderShare = border / borderTotal;
  if (coverage < 0.04) return { ok: false, reason: `الشكل أصغر من أن يُرى (${(coverage * 100).toFixed(1)}%)`, coverage };
  if (coverage > 0.72) return { ok: false, reason: `الشكل يملأ الإطار (${(coverage * 100).toFixed(1)}%)`, coverage };
  if (borderShare > 0.45) return { ok: false, reason: 'الشكل يلامس الحواف: خلفية لا موضوع', coverage };
  return { ok: true, coverage: Number(coverage.toFixed(3)), borderShare: Number(borderShare.toFixed(3)) };
}

// الضبابية: بعد blur(16px) لا يبقى إلا توزيع الألوان والكتل. الصورة الرتيبة تصير لا شيء.
export async function blurCheck(file) {
  const { data, info } = await sharp(file).flatten({ background: '#ffffff' }).resize({ width: 64, height: 64, fit: 'fill' })
    .blur(4).raw().toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  let mean = [0, 0, 0];
  const pixels = info.width * info.height;
  for (let i = 0; i < pixels; i++) for (let c = 0; c < 3; c++) mean[c] += data[i * channels + c];
  mean = mean.map((v) => v / pixels);
  let variance = 0;
  for (let i = 0; i < pixels; i++) {
    for (let c = 0; c < 3; c++) { const d = data[i * channels + c] - mean[c]; variance += d * d; }
  }
  const spread = Math.sqrt(variance / (pixels * 3));
  return { ok: spread >= 24, spread: Number(spread.toFixed(1)), reason: spread >= 24 ? null : `بعد التضبيب تبقى الصورة كتلة واحدة (تباين ${spread.toFixed(1)})` };
}

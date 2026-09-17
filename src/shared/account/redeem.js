// تطبيع رموز الهدايا وتجزئتها؛ قائمة العميل فارغة، والخادم وحده يمرر البصمات المسموحة.
import { REDEEM_CODE_HASHES } from './config.js';
import { sha256Hex } from '../lib/sha256.js';

const DIGITS = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' };
export const CODE_MIN = 4;
export const CODE_MAX = 64;

// الأرقام العربية والفارسية → لاتينية، بلا مسافات ولا شرطات، وبأحرف كبيرة (الرمز لا يميّز الحالة).
export function normalizeCode(input) {
  return String(input || '')
    .replace(/[٠-٩۰-۹]/g, (d) => DIGITS[d] || d)
    .replace(/[\s\-_.]/g, '')
    .toUpperCase();
}

export const codeHash = (code) => sha256Hex(normalizeCode(code));

export function isValidCode(code, hashes = REDEEM_CODE_HASHES) {
  const normalized = normalizeCode(code);
  if (normalized.length < CODE_MIN || normalized.length > CODE_MAX) return false;
  const hash = sha256Hex(normalized);
  return (hashes || []).some((known) => String(known).toLowerCase() === hash);
}

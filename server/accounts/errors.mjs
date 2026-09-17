// أخطاء الحسابات: نعيد استعمال RoomError/fail كي يخرجها errorResponse بالشكل {error} نفسه.
import { RoomError, fail } from '../room-model.mjs';
export { RoomError, fail };

// الأكواد التي يعرفها العميل (src/shared/account/errors.js) مع حالتها HTTP.
export const STATUS = {
  AUTH_REQUIRED: 401,
  AUTH_EXPIRED: 401,
  PLUS_REQUIRED: 402,
  ALREADY_LINKED: 409,
  ALREADY_SUBSCRIBED: 409,
  SIGNATURE: 401,
  PROVIDER: 502,
  BILLING_CANCEL_FAILED: 502,
  CHECKOUT_PENDING: 409,
  CHECKOUT_REVIEW: 409,
  CHECKOUT_DISABLED: 503,
  IP_FORBIDDEN: 403,
  IP_UNAVAILABLE: 503,
  STATE: 400,
  NOT_ELIGIBLE: 400,
  INVALID: 400,
  RATE_LIMIT: 429,
  REDEEM_INVALID: 400,
  NOT_FOUND: 404,
  INTERNAL: 500,
};
// مختصر: `failure('STATE')` بدل تكرار رقم الحالة في كل نداء.
export function failure(code) { fail(code, STATUS[code] ?? 400); }

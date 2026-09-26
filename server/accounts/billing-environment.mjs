// Paddle datasets are separate. Never infer that an unclassified historical row
// belongs to the currently configured account; a verified webhook can classify it.
export const paddleEnvironmentOf = (env) => env.PADDLE_ENV === 'production' ? 'production' : 'sandbox';
// معاملات آبل من بيئة Sandbox (TestFlight) تُحفظ للتدقيق لكنها لا تمنح استحقاقًا حين
// يعمل العامل في بيئة الفوترة الإنتاجية؛ وإلا حصل كل مختبِر على «بلس» مجانًا على الموقع.
// APPLE_ALLOW_SANDBOX_ENTITLEMENTS=1 تسمح بها صراحةً على عامل تجربة يعمل بإعداد إنتاجي.
const appleSandboxAllowed = (env) => paddleEnvironmentOf(env) !== 'production' || env.APPLE_ALLOW_SANDBOX_ENTITLEMENTS === '1';
export const inBillingEnvironment = (env, row) => {
  if (row.source === 'paddle') return row.environment === paddleEnvironmentOf(env);
  if (row.source === 'apple') return String(row.environment || '').toLowerCase() !== 'sandbox' || appleSandboxAllowed(env);
  return true;
};

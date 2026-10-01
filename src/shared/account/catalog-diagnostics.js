// Local support details only. Never include receipts, account IDs, URLs, or raw errors.
const OUTCOMES = new Set(['success', 'empty', 'missing-config', 'storekit-error', 'storekit-timeout', 'unexpected-products', 'bridge-timeout', 'bridge-unavailable', 'native-error']);
const token = (value, pattern) => typeof value === 'string' && pattern.test(value) ? value : null;
const identifier = (value) => token(value, /^[A-Za-z0-9_.-]{1,80}$/);
const version = (value) => token(value, /^[0-9.]{1,24}$/);

export function catalogDiagnostics(raw, fallback = 'native-error') {
  const source = raw && typeof raw === 'object' ? raw : {};
  const result = { outcome: OUTCOMES.has(source.outcome) ? source.outcome : OUTCOMES.has(fallback) ? fallback : 'native-error' };
  for (const key of ['bundleId']) {
    const value = identifier(source[key]);
    if (value) result[key] = value;
  }
  for (const key of ['version', 'build', 'iOSVersion']) {
    const value = version(source[key]);
    if (value) result[key] = value;
  }
  const country = token(source.storefrontCountry, /^[A-Z]{3}$/);
  if (country) result.storefrontCountry = country;
  if (typeof source.canMakePayments === 'boolean') result.canMakePayments = source.canMakePayments;
  if (Number.isFinite(source.elapsedMs)) result.elapsedMs = Math.max(0, Math.min(600_000, Math.round(source.elapsedMs)));
  for (const key of ['requestedIds', 'returnedIds']) {
    if (Array.isArray(source[key])) result[key] = source[key].filter((id) => id === 'plus.monthly' || id === 'plus.yearly').slice(0, 2);
  }
  if (Array.isArray(source.errorChain)) {
    result.errorChain = source.errorChain.slice(0, 3).filter((item) => identifier(item?.domain) && Number.isSafeInteger(item?.code))
      .map(({ domain, code }) => ({ domain, code }));
  }
  return result;
}

export function catalogSupportText(details) {
  if (!details) return '';
  const safe = catalogDiagnostics(details);
  return Object.entries(safe).map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`).join('\n');
}

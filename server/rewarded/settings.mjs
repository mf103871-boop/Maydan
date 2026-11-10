import { MAFIA_PREVIEW_API_ORIGIN, PRODUCTION_API_ORIGIN } from '../../src/shared/lib/environment.js';
import { sha256 } from '../protocol.mjs';

export const SAMPLE_IOS_REWARDED_UNIT = 'ca-app-pub-3940256099942544/1712485313';
export const REWARDED_PREVIEW_QA_UNIT = 'ca-app-pub-6382290742060099/3289860273';
export function validRewardedPreviewSetupExpiry(value, now = Date.now()) {
  const expires = /^\d{13}$/.test(value || '') ? Number(value) : 0;
  return expires > now && expires <= now + 15 * 60_000;
}
const SAMPLE_PUBLISHER = 'ca-app-pub-3940256099942544/';
const LOOPBACK_ORIGIN = /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+$/;
const ADMOB_UNIT = /^ca-app-pub-\d{16}\/\d{10}$/;
const TESTER_SHA256 = /^[a-f0-9]{64}$/;

export const rewardedPreviewUserHash = userId => sha256(`maydan:rewarded:preview-user:v1:${userId}`);

// The full production Worker deliberately leaves APP_ORIGIN blank. Scope
// Rewarded to its own explicit host without changing other features' routing.
export const rewardedOrigin = (env, environment) =>
  environment === 'production' ? env.REWARDED_ORIGIN : env.APP_ORIGIN;

export function ownedRewardedUnit(value) {
  return typeof value === 'string' && ADMOB_UNIT.test(value) && !value.startsWith(SAMPLE_PUBLISHER) ? value : null;
}

// A host selects a ledger namespace independently of availability. Settlement
// of a room that already started can finish while its offer is disabled.
export function rewardedLedgerEnvironment(env) {
  if (!env.DB) return null;
  if (env.REWARDED_ENV === 'local' && env.PADDLE_ENV !== 'production' &&
      env.AUTH_DEV_FAKE === '1' && LOOPBACK_ORIGIN.test(env.APP_ORIGIN || '')) return 'local';
  if (env.AUTH_DEV_FAKE === '1') return null;
  if (env.REWARDED_ENV === 'ios-preview' && env.PADDLE_ENV !== 'production' &&
      env.APP_ORIGIN === MAFIA_PREVIEW_API_ORIGIN) return 'ios-preview';
  if (env.REWARDED_ENV === 'production' && env.REWARDED_ORIGIN === PRODUCTION_API_ORIGIN) return 'production';
  return null;
}

export function rewardedEnvironment(env) {
  const environment = rewardedLedgerEnvironment(env);
  if (environment === 'production') {
    return env.REWARDED_PRODUCTION_ENABLED === '1' && hostedRewardedSettings(env, environment) ? environment : null;
  }
  if (environment === 'ios-preview' && !TESTER_SHA256.test(env.REWARDED_PREVIEW_USER_SHA256 || '')) return null;
  return env.REWARDED_PREVIEW_ENABLED === '1' ? environment : null;
}

export function hostedRewardedSettings(env, environment) {
  const unit = ownedRewardedUnit(env.REWARDED_IOS_AD_UNIT);
  if (['ios-preview', 'production'].includes(environment) && unit && env.REWARDED_SSV_KEYS === 'production') {
    return { unit, keys: 'production' };
  }
  if (environment === 'ios-preview' && !env.REWARDED_IOS_AD_UNIT && env.REWARDED_SSV_KEYS === 'test') {
    return { unit: SAMPLE_IOS_REWARDED_UNIT, keys: 'test' };
  }
  return null;
}

export function matchesRewardedUnit(signed, expected) {
  return typeof expected === 'string' && (signed === expected ||
    (ADMOB_UNIT.test(expected) && signed === expected.split('/')[1]));
}

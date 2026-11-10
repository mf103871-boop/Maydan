import { resolveNativeBuildOrigin } from './release-environment.mjs';

export const SAMPLE_APP_ID = 'ca-app-pub-3940256099942544~1458002511';
export const SAMPLE_REWARDED_UNIT = 'ca-app-pub-3940256099942544/1712485313';
const APP_ID = /^ca-app-pub-(\d{16})~\d{10}$/;
const UNIT_ID = /^ca-app-pub-(\d{16})\/\d{10}$/;
const SAMPLE_PUBLISHER = '3940256099942544';

export function resolveRewardedBuild(env = {}) {
  const mode = env.IOS_REWARDED_MODE || 'off';
  const appId = env.IOS_ADMOB_APP_ID || '';
  const adUnit = env.IOS_ADMOB_REWARDED_UNIT_ID || '';
  const testVersion = env.IOS_ADMOB_TEST_VERSION || '';
  if (testVersion && mode !== 'testflight-owned') throw new Error('The AdMob test app version is only for an owned TestFlight build.');
  if (mode === 'off') {
    if (appId || adUnit) throw new Error('AdMob IDs need an explicit iOS Rewarded mode.');
    return null;
  }
  const apiOrigin = resolveNativeBuildOrigin(env);
  const target = env.IOS_RELEASE_ENVIRONMENT || 'production';
  if (mode === 'testflight' && target === 'mafia-preview' && !adUnit) {
    const publisher = APP_ID.exec(appId)?.[1];
    if (appId && (!publisher || publisher === SAMPLE_PUBLISHER)) throw new Error('Use a valid owned AdMob App ID or leave it empty for the Google sample.');
    return { mode, apiOrigin, appId: appId || SAMPLE_APP_ID, adUnit: SAMPLE_REWARDED_UNIT };
  }
  if ((mode === 'live' && target === 'production') || (mode === 'testflight-owned' && target === 'mafia-preview')) {
    const publisher = APP_ID.exec(appId)?.[1];
    if (!publisher || publisher === SAMPLE_PUBLISHER || publisher !== UNIT_ID.exec(adUnit)?.[1]) {
      throw new Error('Owned Rewarded requires AdMob app and unit IDs for the same publisher.');
    }
    if (mode === 'testflight-owned') {
      if (!/^\d+\.\d+(?:\.\d+)?$/.test(testVersion) || testVersion !== env.IOS_VERSION) {
        throw new Error('The exact marketing version verified in AdMob Test apps must match IOS_VERSION.');
      }
      return { mode, apiOrigin, appId, adUnit, testVersion };
    }
    return { mode, apiOrigin, appId, adUnit };
  }
  throw new Error('TestFlight Rewarded requires the isolated API. Live Rewarded requires the production API.');
}

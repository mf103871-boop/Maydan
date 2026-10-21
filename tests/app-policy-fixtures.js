import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const ENV = Object.freeze({ IOS_UPDATE_POLICY_ENABLED: '1', IOS_MIN_SUPPORTED_VERSION: '1.8', IOS_MIN_SUPPORTED_BUILD: '22' });
export const NOW = Date.parse('2026-10-21T06:00:00.000Z');
export const STOREFRONTS = ['JOR', 'SAU', 'ARE', 'USA'];
export const EXPECTED = Object.freeze({ schemaVersion: 1, enabled: true, minimumBuild: 22, minimumVersion: '1.8',
  appStoreId: '6808385717', message: 'يتوفر تحديث جديد لميدان. حدّث التطبيق من App Store للمتابعة.' });
export const DISABLED = Object.freeze({ ...EXPECTED, enabled: false, minimumBuild: 0, minimumVersion: null });

// Public release facts verified on 2026-10-21, retained as a deterministic fixture.
// Tests need no Apple access, operator files, credentials, or local output folders.
const RELEASE_RECORD = {
  schemaVersion: 1, appStoreId: '6808385717', bundleId: 'Maydan', version: '1.8', build: 22,
  buildId: '093728e9-5d77-4d9f-8725-5e1c4de8c5f9',
  appStoreVersionId: 'd15b847b-310e-441a-a579-1533a75c0b25',
  sourceCommit: '2fe524e98f8a455b1b801ab4c0fdd9d82f9396ef',
  verifiedAt: '2026-10-21T04:56:30.151Z',
  evidenceSHA256: 'e01918ea6c1e87304f2c146b3c684b052b0bc842407700dffd13a1aac33a1206',
  officialPublic: true, downloadable: true,
  countries: { JO: { minimumOS: '16.4' }, SA: { minimumOS: '16.4' }, AE: { minimumOS: '16.4' }, US: { minimumOS: '16.4' } },
};
export const clone = () => structuredClone(RELEASE_RECORD);
export const request = (query = 'storefront=JOR&osVersion=26.6.1', options) =>
  new Request(`https://fixture.test/api/app-policy/ios?${query}`, options);
export const data = async (handler, query, env = ENV) => (await handler(request(query), env)).json();

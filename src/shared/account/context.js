import { createContext, useContext } from 'react';
// قيمة السياق حين لا يوجد AccountProvider (اختبارات، تصيير معزول): لا قفل ولا جدار — كل شيء متاح.
export const NULL_ACCOUNT = Object.freeze({
  ready: true, user: null, me: null, premium: false, promo: null, trials: {}, platform: 'web', products: null,
  redeem: async () => false,
  signIn: async () => {}, signOut: async () => {}, refresh: async () => null,
  markTrial: () => {}, trialAvailable: () => true, lockedPack: () => false, gameAccess: () => 'premium',
  openPaywall: () => {}, closePaywall: () => {}, restore: async () => {}, deleteAccount: async () => {},
  // ترويسات المصادقة لطلبات الغرف: {} حين لا جلسة، وإلا { Authorization: 'Bearer …' }
  authHeaders: () => ({}),
});
export const AccountContext = createContext(NULL_ACCOUNT);
export function useAccount() { return useContext(AccountContext); }

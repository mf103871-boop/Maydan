// نقطة دخول واحدة لوحدة الحساب: ما تستورده الشاشات والألعاب.
export { FREE_PACKS, TRIAL_GAMES, PRODUCTS, PLUS_NAME, GRACE_MS, REFRESH_MS, AUTH_CODE_TTL_S } from './config.js';
export { isPremium, lockedPack, trialAvailable, mergeTrials, shouldRefresh, gameAccess } from './entitlements.js';
export { AccountContext, useAccount, NULL_ACCOUNT } from './context.js';
export { ACCOUNT_ERRORS, accountErrorText } from './errors.js';
export { accountStore, createAccountStore, ACCOUNT_PREFIX, KEYS } from './store.js';
export { resolveAccountServer, accountOffline, request, authStartUrl, ClientError } from './api.js';
export { isNativeShell, callNative, onNativeEvent, installNativeBridge, NATIVE_TIMEOUT } from './native.js';
export { loadPaddle, openCheckout, previewPrices } from './paddle.js';
export { AccountProvider } from './AccountProvider.jsx';
export { Paywall, paywallReason } from './Paywall.jsx';
export { PaywallHost } from './PaywallHost.jsx';
export { SignInSheet, SignInButtons } from './SignInSheet.jsx';
export { AccountCard } from './AccountCard.jsx';

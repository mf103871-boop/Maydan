import { getUiLocale, tr } from '../shared/i18n/core.js';
import React from 'react';
import { useAccount } from '../shared/account/context.js';
import { navigate } from '../platform/router.js';
import { paywallReason } from '../shared/account/Paywall.jsx';
export function SubscriptionTransition() {
  const account = useAccount();
  if (!account.signedIn || !account.premium) return null;
  const description = account.gameplayPolicy ? paywallReason('settings', null, account.gameplayPolicy)
    : getUiLocale() === 'en' ? 'Play is free.' : 'اللعب مجاني.';
  return <div className="plus-transition" role="note"><span>{description}</span><button data-design-id="plus-transition-open" type="button" className="btn btn-ghost" onClick={() => navigate('/store')}>{tr("شاهد مظهر بروفايلك")}</button></div>;
}

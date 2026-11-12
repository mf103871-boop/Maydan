import { tr } from '../shared/i18n/core.js';
import React from 'react';
import { useAccount } from '../shared/account/context.js';
import { navigate } from '../platform/router.js';
export function SubscriptionTransition() {
  const account = useAccount();
  if (!account.signedIn || !account.premium) return null;
  return <div className="plus-transition" role="note">{tr("اللعب مجاني. بلس يخصّص شكل بروفايلك وإطار صورتك حتى نهاية استحقاقه، دون تغيير صورتك أو مقتنياتك السابقة. ")}<button data-design-id="plus-transition-open" type="button" className="btn btn-ghost" onClick={() => navigate('/store')}>{tr("شاهد مظهر بروفايلك")}</button></div>;
}

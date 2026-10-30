import React from 'react';
import { useAccount } from '../shared/account/context.js';
import { navigate } from '../platform/router.js';
export function SubscriptionTransition() {
  const account = useAccount();
  if (!account.signedIn || !account.premium) return null;
  return <div className="plus-transition" role="note">كل ألعاب ميدان أصبحت مجانية. اشتراكك الحالي يتيح لك مزايا بلس الجديدة حتى نهاية استحقاقه، دون شراء جديد. <button type="button" className="btn btn-ghost" onClick={() => navigate('/store')}>شاهد لمستك الجديدة</button></div>;
}

// مضيف الجدار: يُصيَّر مرة واحدة في القشرة، والحالة تأتي من AccountProvider
// فيكفي أي شاشة أن تنادي openPaywall({ reason }).
import React from 'react';
import { useAccount } from './context.js';
import { Paywall } from './Paywall.jsx';

export function PaywallHost() {
  const account = useAccount();
  const paywall = account.paywall;
  if (!paywall || !paywall.open) return null;
  return <Paywall open reason={paywall.reason} game={paywall.game} pack={paywall.pack} onClose={account.closePaywall} />;
}

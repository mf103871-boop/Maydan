import React from 'react';
import { Screen, TopBar } from '../../shared/ui/components.jsx';
import { getDirection } from '../router.js';

// A deliberate empty state: this release introduces navigation, not new purchases.
export function Store() {
  return <Screen dir={getDirection()} className="stack store-screen" aria-label="المتجر">
    <TopBar title="المتجر" eyebrow="لمستك الخاصة في ميدان" />
    <section className="store-coming-soon" aria-labelledby="store-coming-title">
      <div className="store-art" aria-hidden="true">
        <svg viewBox="0 0 240 220" fill="none" focusable="false">
          <ellipse cx="120" cy="190" rx="72" ry="12" fill="#352547" opacity=".07" />
          <circle cx="120" cy="103" r="84" fill="#E2F0E9" />
          <path d="M62 68h116l12 104a12 12 0 0 1-12 13H62a12 12 0 0 1-12-13L62 68Z" fill="#FFF9ED" stroke="#CABBAD" strokeWidth="3" />
          <path d="M94 80V58a26 26 0 0 1 52 0v22" stroke="#8353A0" strokeWidth="9" strokeLinecap="round" />
          <path d="M94 80V58a26 26 0 0 1 52 0" stroke="#AF88C8" strokeWidth="3" strokeLinecap="round" />
          <circle cx="120" cy="123" r="34" fill="#DDF0EF" stroke="#91C7C3" strokeWidth="2" />
          <circle cx="120" cy="114" r="11" fill="#258D94" />
          <path d="M100 142a20 20 0 0 1 40 0" fill="#258D94" />
          <path d="m183 29 3 8 8 3-8 3-3 8-3-8-8-3 8-3 3-8Z" fill="#D4A02F" />
          <path d="m42 106 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z" fill="#9570B0" />
          <circle cx="198" cy="122" r="5" fill="#23A5A9" opacity=".6" />
          <circle cx="55" cy="43" r="4" fill="#D4A02F" opacity=".6" />
        </svg>
      </div>
      <span className="store-soon-label">قريبًا</span>
      <h2 id="store-coming-title">قريبًا في متجر ميدان</h2>
      <p>أشكال جديدة لبروفايلك وصورتك الشخصية،<br className="store-copy-break" /> تعبّر عنك وتكمل حضورك في اللّمة.</p>
      <span className="store-coming-note">نجهّز لك شيئًا على ذوقك</span>
    </section>
  </Screen>;
}

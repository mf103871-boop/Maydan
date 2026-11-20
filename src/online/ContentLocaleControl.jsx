import React from 'react';
import { tr } from '../shared/i18n/core.js';
import { IconGlobe } from '../shared/ui/icons.jsx';

export function MatchLanguage({ value = 'ar', compact = false }) {
  return <div className={'online-field' + (compact ? ' is-compact' : '')}>
    <span className="online-field-label"><IconGlobe />{tr('لغة المباراة')}</span>
    <strong data-design-id="content-language" lang={value}>{value === 'en' ? 'English' : 'العربية'}</strong>
    {!compact && <small>{tr('يتشارك الجميع محتوى المباراة نفسه؛ لغة واجهتك مستقلة.')}</small>}
  </div>;
}

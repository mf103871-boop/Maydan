import { tr } from '../shared/i18n/core.js';
import React, { useState } from 'react';
import { useI18n } from '../shared/i18n/react.jsx';
import { contentVersionFor } from '../shared/content-locale.mjs';
import { hasEnglishContentPack, loadGameContent } from '../data/game-content.js';

export function hasEnglishContent(game) {
  if (['mafia', 'ersomha'].includes(game)) return true;
  return hasEnglishContentPack(game);
}
export function ContentLocaleControl({ value = 'ar', game, englishAvailable = false, disabled = false, readOnly = false, onChange }) {
  const { t } = useI18n();
  const [loading,setLoading] = useState(false), [loadError,setLoadError] = useState(false);
  const change = async value => {
    if (loading) return;
    setLoadError(false);setLoading(true);
    try {
      if (value === 'en' && !['mafia','ersomha'].includes(game)) await loadGameContent(game,value,contentVersionFor(value));
      await onChange(value);
    } catch { setLoadError(true); }
    finally { setLoading(false); }
  };
  return <label className="online-field">
    <span>{t('لغة المباراة')}</span>
    {readOnly ? <strong data-design-id="content-language" lang={value}>{value === 'en' ? 'English' : tr("العربية")}</strong> :
      <select data-design-id="content-language" aria-label={t('لغة المباراة')} value={value} disabled={disabled || loading} onChange={event => change(event.target.value)}>
        <option value="ar">{tr("العربية")}</option><option value="en" disabled={!englishAvailable || !hasEnglishContent(game)}>English</option>
      </select>}
    <small>{t('يتشارك الجميع محتوى المباراة نفسه؛ لغة واجهتك مستقلة.')}</small>
    {loading && <small role="status">{t('جارٍ تحميل حزمة اللغة…')}</small>}
    {loadError && <small role="alert">{t('تعذّر تحميل حزمة اللغة. اختر اللغة مجددًا لإعادة المحاولة.')}</small>}
  </label>;
}

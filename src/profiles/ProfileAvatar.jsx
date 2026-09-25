import React, { useState } from 'react';
import { profileTheme, avatarPreset } from './catalog.js';
import { profileAssetUrl } from './identity.js';
import { resolveAccountServer } from '../shared/account/api.js';

export function ProfileAvatar({ user, size = 44, className = '' }) {
  const [failed, setFailed] = useState(null);
  const url = profileAssetUrl(user?.avatarUrl, resolveAccountServer());
  const theme = profileTheme(user?.theme);
  return <span className={'player-avatar ' + className} aria-hidden="true" style={{ width: size, height: size,
    display: 'inline-flex', flexShrink: 0, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    borderRadius: '32%', background: theme.accent, color: theme.color, fontSize: Math.round(size * 0.51), lineHeight: 1 }}>
    {url && failed !== url ? <img src={url} alt="" width={size} height={size} loading="lazy" decoding="async"
      style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={() => setFailed(url)} /> : avatarPreset(user?.avatarPreset).emoji}
  </span>;
}

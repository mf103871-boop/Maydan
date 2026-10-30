import React, { useState } from 'react';
import { profileTheme, avatarPreset } from './catalog.js';
import { profileAssetUrl } from './identity.js';
import { resolveAccountServer } from '../shared/account/api.js';
import { getCosmetic } from '../plus/catalog.js';

export function ProfileAvatar({ user, size = 44, className = '' }) {
  const [failed, setFailed] = useState([]);
  const avatar = getCosmetic(user?.cosmetics?.avatarId, { kind: 'avatar' });
  const frame = getCosmetic(user?.cosmetics?.frameId, { kind: 'frame' });
  const url = [avatar?.assetUrl, profileAssetUrl(user?.avatarUrl, resolveAccountServer())].find(value => value && !failed.includes(value));
  const theme = profileTheme(user?.theme);
  return <span className={'player-avatar plus-avatar-shell ' + (frame ? 'is-framed ' : '') + className} aria-hidden="true" style={{ width: size, height: size, boxSizing: 'border-box', '--plus-frame-color': frame?.accent, '--plus-frame-shadow': frame?.color,
    display: 'inline-flex', flexShrink: 0, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    borderRadius: '32%', background: theme.accent, color: theme.color, fontSize: Math.round(size * 0.51), lineHeight: 1 }}>
    {url ? <img src={url} alt="" className={url === avatar?.assetUrl ? 'plus-avatar-art' : undefined} width={size} height={size} loading="lazy" decoding="async"
      style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: frame ? '28%' : undefined }} onError={() => setFailed(previous => [...previous, url].slice(-8))} /> : avatarPreset(user?.avatarPreset).emoji}
  </span>;
}

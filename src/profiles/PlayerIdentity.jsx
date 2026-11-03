import React, { useState } from 'react';
import { getCosmetic } from '../plus/catalog.js';
import { ProfileAvatar } from './ProfileAvatar.jsx';

export function MembershipBadge({ user, compact = false }) {
  // Effective server projection; never infer membership from a purchase or frame.
  if (user?.cosmetics?.badge !== true) return null;
  return <span className={'player-membership-badge' + (compact ? ' is-compact' : '')} aria-label="عضو ميدان بلس"><span aria-hidden="true">✦</span><span>بلس</span></span>;
}

export function NameCard({ user, children, className = '', enabled = true }) {
  const item = enabled ? getCosmetic(user?.cosmetics?.nameColorId, { kind: 'nameColor' }) : null;
  const [failed, setFailed] = useState(null);
  const art = item?.nameCardAsset;
  return <span className={'player-name-card' + (item ? ' is-equipped' : '') + ' ' + className}
    data-name-card={item?.id} style={item ? { '--identity-name-bg': item.color, '--identity-name-accent': item.accent, '--identity-name-ink': item.nameCardTextColor || item.textColor } : undefined}>
    {art && failed !== art && <img key={art} src={art} alt="" aria-hidden="true" loading="lazy" decoding="async" onError={() => setFailed(art)} />}
    <span className="player-name-card-text">{children}</span>
  </span>;
}

export function PlayerName({ user, name, className = '', card = false, badge = true, compact = false }) {
  const color = getCosmetic(user?.cosmetics?.nameColorId, { kind: 'nameColor' });
  return <span className={'player-identity-name ' + (compact ? 'is-compact ' : '') + className}>
    <NameCard user={user} enabled={card}><bdi style={!card && color ? { color: color.color } : undefined}>{name || user?.name?.trim() || 'لاعب ميدان'}</bdi></NameCard>
    {badge && <MembershipBadge user={user} compact={compact} />}
  </span>;
}

export function PlayerIdentity({ user, size = 40, name, subtitle, className = '', card = true, badge = true }) {
  return <span className={'player-identity ' + className}>
    <ProfileAvatar user={user} size={size} />
    <span className="player-identity-copy"><PlayerName user={user} name={name} card={card} badge={badge} compact={size <= 32} />{subtitle && <small>{subtitle}</small>}</span>
  </span>;
}

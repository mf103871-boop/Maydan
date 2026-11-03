import React, { useRef, useState } from 'react';
import { profileTheme, avatarPreset } from './catalog.js';
import { profileAssetUrl } from './identity.js';
import { resolveAccountServer } from '../shared/account/api.js';
import { getCosmetic } from '../plus/catalog.js';
import { useIdentityMotion } from './useIdentityMotion.js';
import { cosmeticPosterSources } from './identity-assets.js';

export function frameDetail(size) { return size <= 28 ? 'small' : size <= 64 ? 'medium' : 'large'; }

export function ProfileAvatar({ user, size = 44, className = '' }) {
  const ref = useRef(null);
  const [failed, setFailed] = useState([]);
  const avatar = getCosmetic(user?.cosmetics?.avatarId, { kind: 'avatar' });
  const frame = getCosmetic(user?.cosmetics?.frameId, { kind: 'frame' });
  const detail = frameDetail(size);
  const frameUrl = [frame?.frameAssets?.[detail], frame?.frameAssets?.large, frame?.frameAssets?.medium, frame?.frameAssets?.small].find(value => value && !failed.includes(value));
  const poster = cosmeticPosterSources(avatar).find(value => !failed.includes(value));
  const uploaded = profileAssetUrl(user?.avatarUrl, resolveAccountServer());
  const url = [poster, uploaded].find(value => value && !failed.includes(value));
  const theme = profileTheme(user?.theme);
  const innerScale = frame ? Math.min(1, Math.max(0.5, Number(frame.innerScale) || 0.82)) : 1;
  const majestic = frame?.motionKind === 'majestic';
  const calm = frame?.motionKind === 'calm';
  // The calm frame moves only at profile scale. Small identities stay static
  // so a contact list or a live call never becomes a wall of moving ornaments.
  const motion = frame?.motionKind === 'light-sweep' || majestic || calm && detail === 'large';
  const layers = poster && url === poster ? Object.entries(avatar?.layerAssets || {}).filter(([kind, value]) => ['foreground', 'glow', 'sparkle'].includes(kind) && typeof value === 'string' && !failed.includes(value)) : [];
  const layered = avatar?.motionKind === 'layered-idle' && layers.length > 0;
  const running = useIdentityMotion(ref, motion || layered);
  const fail = value => setFailed(previous => [...previous.filter(item => item !== value), value].slice(-12));
  return <span ref={ref} className={'player-avatar plus-avatar-shell ' + (frame ? 'is-framed ' : '') + className} aria-hidden="true"
    data-frame-detail={detail} data-frame-motion={calm?'calm':majestic?'majestic':undefined} data-frame-art={frameUrl ? 'true' : undefined} data-identity-motion={running ? 'running' : 'paused'}
    style={{ width: size, height: size, minWidth: size, boxSizing: 'border-box', '--plus-frame-color': frame?.accent, '--plus-frame-shadow': frame?.color, '--identity-portrait-inset': `${(1 - innerScale) * 50}%`,
      display: 'inline-flex', flexShrink: 0, alignItems: 'center', justifyContent: 'center', overflow: 'visible', border: 0, padding: 0,
      borderRadius: '32%', background: 'transparent', fontSize: Math.round(size * 0.51), lineHeight: 1 }}>
    {majestic && detail!=='small' && <span className="player-avatar-majestic-halo"/>}
    {calm && detail!=='small' && <span className="player-avatar-calm-halo"/>}
    <span className="player-avatar-portrait" style={{ background: theme.accent, color: theme.color }}>
      {url ? <img key={url} src={url} alt="" className={url === poster ? 'plus-avatar-art' : undefined} width={size} height={size} loading="lazy" decoding="async" onError={() => fail(url)} /> : avatarPreset(user?.avatarPreset).emoji}
      {layers.map(([kind, value]) => <img key={kind + value} src={value} alt="" className={'player-avatar-layer is-' + kind + (layered ? ' has-motion' : '')} loading="lazy" decoding="async" onError={() => fail(value)} />)}
    </span>
    {frame && <span className={'player-avatar-frame' + (!frameUrl ? ' is-fallback' : '')}>
      {frameUrl && <img key={frameUrl} src={frameUrl} alt="" width={Math.ceil(size * 1.32)} height={Math.ceil(size * 1.32)} loading="lazy" decoding="async" onError={() => fail(frameUrl)} />}
      {motion && !calm && <span className="player-avatar-frame-light" />}
      {calm && detail==='large' && <span className="player-avatar-calm-orbit"/>}
      {majestic && detail!=='small' && <span className="player-avatar-majestic-orbit"/>}
      {majestic && detail==='large' && [0,1,2,3].map(i=><span key={i} className={'player-avatar-majestic-spark spark-'+i}/>)}
    </span>}
  </span>;
}

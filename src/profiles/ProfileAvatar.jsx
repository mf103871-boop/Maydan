import React, { useRef, useState } from 'react';
import { cssAssetUrl } from '../shared/ui/css-asset-url.js';
import { profileTheme, avatarPreset } from './catalog.js';
import { profileAssetUrl } from './identity.js';
import { resolveAccountServer } from '../shared/account/api.js';
import { MAFIA_PREVIEW_API_ORIGIN } from '../shared/lib/environment.js';
import { getCosmetic } from '../plus/catalog.js';
import { useIdentityMotion } from './useIdentityMotion.js';
import { cosmeticPosterSources } from './identity-assets.js';
import { getAvatarArt, getFrameArt, getAvatarBackground } from '../shared/brand/playful-identity.js';

export function frameDetail(size) { return size <= 28 ? 'small' : size <= 64 ? 'medium' : 'large'; }

export function canPreviewLivingFrames() {
  return typeof __MAYDAN_ROOMS_URL__ === 'string' && __MAYDAN_ROOMS_URL__ === MAFIA_PREVIEW_API_ORIGIN &&
    globalThis.location?.protocol === 'maydan:' && globalThis.location.host === 'app';
}

export function ProfileAvatar({ user, size = 44, className = '', previewFrameId, presentation = 'avatar' }) {
  const ref = useRef(null);
  const [failed, setFailed] = useState([]);
  const avatar = getCosmetic(user?.cosmetics?.avatarId, { kind: 'avatar' });
  const preview = previewFrameId && canPreviewLivingFrames()
    ? getCosmetic(previewFrameId, { kind: 'frame', now: Number.MAX_SAFE_INTEGER }) : null;
  const frame = preview?.motionKind === 'living-frame' ? preview : getCosmetic(user?.cosmetics?.frameId, { kind: 'frame' });
  const detail = frameDetail(size);
  const frameUrl = [getFrameArt(frame?.id), ...[detail, 'large', 'medium', 'small'].flatMap(variant => [
    frame?.frameAssets?.[variant], frame?.fallbackFrameAssets?.[variant],
  ])].find(value => value && !failed.includes(value));
  const poster = cosmeticPosterSources(avatar).find(value => !failed.includes(value));
  const uploaded = profileAssetUrl(user?.avatarUrl, resolveAccountServer());
  const presetArt = getAvatarArt(avatarPreset(user?.avatarPreset).id, size);
  const url = [poster, uploaded, presetArt].find(value => value && !failed.includes(value));
  // The same saved preset can stand behind a score podium. Uploaded images,
  // cosmetics and equipped frames keep their existing portrait presentation.
  const cutout = presentation === 'cutout' && url === presetArt && Boolean(presetArt) && !frame;
  const fallback = String(user?.name || 'م').trim().slice(0, 1) || 'م';
  const theme = profileTheme(user?.theme);
  // The default identity palette follows the approved character family. An
  // explicitly selected alternate profile theme keeps its saved accent.
  const portraitBackground = url === presetArt && (!user?.theme || user.theme === 'teal')
    ? getAvatarBackground(avatarPreset(user?.avatarPreset).id) : theme.accent;
  const legacyFrame = frameUrl && Object.values(frame?.fallbackFrameAssets || {}).includes(frameUrl);
  const innerScale = frame ? Math.min(1, Math.max(0.5, (!legacyFrame && Number(frame.innerScale)) || 0.82)) : 1;
  const liveFrame = frame?.motionKind === 'living-frame' && detail !== 'small' && Boolean(frameUrl);
  const showSparks = liveFrame && detail === 'large';
  const layers = poster && url === poster ? Object.entries(avatar?.layerAssets || {}).filter(([kind, value]) => ['foreground', 'glow', 'sparkle'].includes(kind) && typeof value === 'string' && !failed.includes(value)) : [];
  const layered = avatar?.motionKind === 'layered-idle' && layers.length > 0;
  const running = useIdentityMotion(ref, liveFrame || layered);
  const fail = value => setFailed(previous => [...previous.filter(item => item !== value), value].slice(-12));
  return <span ref={ref} className={'player-avatar plus-avatar-shell ' + (frame ? 'is-framed ' : '') + className} aria-hidden="true"
    data-frame-detail={detail} data-frame-theme={frame?.frameTheme} data-frame-art={frameUrl ? 'true' : undefined} data-avatar-art={url === presetArt && presetArt ? 'studio' : undefined} data-avatar-presentation={cutout ? 'cutout' : 'avatar'} data-identity-motion={running ? 'running' : 'paused'}
    style={{ width: size, height: size, minWidth: size, boxSizing: 'border-box', '--plus-frame-color': frame?.accent, '--plus-frame-shadow': frame?.color, '--identity-portrait-inset': `${(1 - innerScale) * 50}%`,
      display: 'inline-flex', flexShrink: 0, alignItems: 'center', justifyContent: 'center', overflow: 'visible', border: 0, padding: 0,
      borderRadius: '32%', background: 'transparent', fontSize: Math.round(size * 0.51), lineHeight: 1 }}>
    {showSparks && <span className="player-avatar-live-halo" />}
    <span className="player-avatar-portrait" style={{ background: cutout ? 'transparent' : portraitBackground, color: theme.color, ...(cutout ? {borderRadius:0,boxShadow:'none',overflow:'visible'} : {}) }}>
      {url ? <img key={url} src={url} alt="" className={url === poster ? 'plus-avatar-art' : url === presetArt ? 'player-avatar-preset-art' : undefined} width={size} height={size} loading="lazy" decoding="async" onError={() => fail(url)} /> : fallback}
      {layers.map(([kind, value]) => <img key={kind + value} src={value} alt="" className={'player-avatar-layer is-' + kind + (layered ? ' has-motion' : '')} loading="lazy" decoding="async" onError={() => fail(value)} />)}
    </span>
    {frame && <span className={'player-avatar-frame' + (!frameUrl ? ' is-fallback' : '')}>
      {frameUrl && <img key={frameUrl} src={frameUrl} alt="" width={Math.ceil(size * 1.32)} height={Math.ceil(size * 1.32)} loading="lazy" decoding="async" onError={() => fail(frameUrl)} />}
      {liveFrame && <span className="player-avatar-frame-light" style={{ '--identity-frame-mask': cssAssetUrl(frameUrl) }} />}
      {showSparks && <span className="player-avatar-live-sparks"><i /><i />{frame.frameTheme === 'signature' && <><i /><i /></>}</span>}
    </span>}
  </span>;
}

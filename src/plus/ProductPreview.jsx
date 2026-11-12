import { tr } from '../shared/i18n/core.js';
import React, { useState } from 'react';
import { ProfileAvatar } from '../profiles/ProfileAvatar.jsx';
import { PlayerIdentity } from '../profiles/PlayerIdentity.jsx';
import { cosmeticSelection } from './store-model.js';
import { getCosmetic, subscriptionIncludesKind } from './catalog.js';
import { profileAssetUrl } from '../profiles/identity.js';
import { resolveAccountServer } from '../shared/account/api.js';
import { profileSkin, profileSkinStyle } from '../profiles/profile-skin.js';
import { PresentationStyles } from '../shared/ui/PresentationStyles.jsx';
import skinCss from '../profiles/profile-skin.css?sheet';

export function StoreImage({ src, ...props }) {
  const [failed, setFailed] = useState(null);
  return src && failed !== src ? <img {...props} src={src} onError={() => setFailed(src)} /> : null;
}
export function ProductArtwork({ item, user, size = 88 }) {
  if (item.kind === 'frame') return <span className="store-product-avatar kind-frame"><ProfileAvatar user={{ ...user, cosmetics: { ...user?.cosmetics, frameId: item.id } }} size={size}/></span>;
  return <span className="store-world-art kind-profileSkin"><StoreImage src={item.posterUrl || item.assetUrl} alt="" loading="lazy"/><span>{tr("شكل البروفايل")}</span><ProfileAvatar user={{ ...user, cosmetics: { ...user?.cosmetics, frameId: 'plus.signature.frame' } }} size={62}/></span>;
}
// Preview touches only the two subscription slots. The personal photograph and
// other saved preferences remain unchanged until an explicit equip action.
export function ProductPreview({ user, items = [] }) {
  const selection = { ...user?.cosmetics, ...cosmeticSelection(items.filter(item => subscriptionIncludesKind(item.kind))) };
  const previewUser = { ...user, cosmetics: selection };
  const cover = getCosmetic(user?.cosmetics?.coverId, { kind: 'cover' });
  const coverUrl = profileAssetUrl(user?.coverUrl, resolveAccountServer()) || cover?.posterUrl || cover?.assetUrl;
  const skinStyle = profileSkinStyle(selection);
  return <div className="store-product-preview" data-design-id="product-preview"><PresentationStyles sheet={skinCss}/>
    <div className="store-preview-comparison" aria-label={tr("المظهر الحالي والمقترح")}><div><b>{tr("حاليًا")}</b><ProfileAvatar user={user} size={55}/></div><span aria-hidden="true">←</span><div><b>{tr("في المعاينة")}</b><ProfileAvatar user={previewUser} size={55}/></div></div>
    <div className="store-preview-profile" data-profile-skin={profileSkin(selection) ? 'sahra' : 'base'} style={skinStyle} role="region" aria-label={tr("معاينة بروفايلك")}>
      <div className="store-preview-cover">{coverUrl && <StoreImage src={coverUrl} alt=""/>}</div>
      <div className="store-preview-person"><PlayerIdentity user={previewUser} size={80}/><small>{tr("صورتك واسمك كما اخترتهما")}</small></div>
      {profileSkin(selection) && <div className="store-preview-profile-panels"><div><strong>{tr("بصمتك")}</strong><span>{tr("ألوان وخامات متناسقة")}</span></div><div><strong>{tr("ملفك")}</strong><span>{tr("بطاقات بروفايل بهوية ميدان")}</span></div></div>}
    </div>{profileSkin(selection) && <div className="store-preview-palette"><b>{tr("ألوان المظهر")}</b><div aria-hidden="true">{['--profile-accent','--profile-soft','--profile-deep','--profile-gradient'].map(color => <span key={color} style={{ background: skinStyle[color] }}/>)}</div></div>}
    <p className="store-product-note">{tr("يتغيّر مظهرك عند اختيار «استخدام».")}</p>
  </div>;
}

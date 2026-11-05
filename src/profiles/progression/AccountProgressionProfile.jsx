import React, { useRef, useState } from 'react';
import { Button, Modal } from '../../shared/ui/components.jsx';
import { usePlusResource, plusError } from '../../plus/usePlusAccount.js';
import { getCosmetic } from '../../plus/catalog.js';
import { MenuGameIcon } from '../../platform/MenuGameIcon.jsx';
import { ProfileAvatar } from '../ProfileAvatar.jsx';
import { getProgressionFrame, PROGRESSION_FRAMES } from '../progression-catalog.js';
import { ProgressionCatalog, ProgressionPortrait, ProgressionProfile, ProgressionStyles, progressionNumber } from './ProgressionProfile.jsx';

const badgeArt = {
  'all-games': 'achievement-explorer',
  explorer: 'achievement-explorer',
  gatherings: 'achievement-host',
  host: 'achievement-host',
};
const image = (profile, framed = false) => <ProfileAvatar user={framed ? profile : {
  ...profile, cosmetics: { ...profile.cosmetics, frameId: null },
}} size={220} />;

export function AccountProgressionProfile({ profile, profiles, owner, title, featured, onCustomize, cover }) {
  const progress = profile.progression;
  const [dialog, setDialog] = useState(null);
  const [chosen, setChosen] = useState(null);
  const [previousFrame, setPreviousFrame] = useState(undefined);
  const [notice, setNotice] = useState(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const wardrobe = usePlusResource('/api/me/cosmetics', Boolean(owner && dialog?.kind === 'wardrobe'));
  const equippedId = profile.cosmetics?.frameId || null;
  const equippedProgression = getProgressionFrame(equippedId);
  const unframedPortrait = image(profile);
  const layeredPortrait = equippedId && !equippedProgression ? image(profile, true) : null;
  const owned = new Map((progress.owned || []).map(grant => [grant.itemId, grant]));
  const items = PROGRESSION_FRAMES.map(frame => ({
    ...frame, type: 'frame',
    state: owned.has(frame.id) ? frame.id === equippedId ? 'equipped' : 'owned' : 'locked',
    grantedAt: owned.get(frame.id)?.grantedAt,
  }));
  const nextReward = progress.nextReward && getProgressionFrame(progress.nextReward.itemId);
  const selected = items.find(item => item.id === chosen);
  const badges = featured.map(badge => ({
    ...badge,
    art: badgeArt[badge.id] || 'ornament-gem',
    detail: owner ? badge.description : null,
  }));
  const mastery = (progress.mastery || []).map(track => track.game === 'ersomha'
    ? { ...track, artNode: <span className="pc-track-art pc-track-existing"><MenuGameIcon id="ersomha" /></span> }
    : track);
  const openWardrobe = item => {
    if (!owner) return;
    setChosen(item?.id || item?.itemId || null);
    setNotice(null);
    setDialog({ kind: 'wardrobe' });
  };
  const close = () => { if (!savingRef.current) setDialog(null); };
  const apply = async (frameId, undo = false) => {
    if (!owner || savingRef.current || !Number.isSafeInteger(wardrobe.data?.revision)
      || (frameId !== null && !owned.has(frameId) && !(undo && frameId === previousFrame && getCosmetic(frameId)))) return;
    if ((wardrobe.data.effective?.frameId || null) === frameId) return;
    savingRef.current = true;
    setSaving(true); setNotice(null);
    try {
      const result = await wardrobe.request('/api/me/cosmetics', {
        method: 'PATCH',
        body: { selection: { frameId }, revision: wardrobe.data.revision },
      });
      if (result.preferred?.frameId !== frameId || (result.effective?.frameId || null) !== frameId) {
        setNotice({ error: true, text: 'تعذّر تجهيز هذا الإطار بحقوق حسابك الحالية.' });
        return;
      }
      setPreviousFrame(undo ? undefined : equippedId);
      await Promise.allSettled([wardrobe.reload(), profiles.loadProfile(), wardrobe.account.refresh()]);
      setNotice({ text: undo ? 'عاد الإطار السابق.' : 'تجهّز الإطار في بروفايلك.' });
    } catch (error) {
      if (error.code === 'STALE_ACCOUNT') return;
      setNotice({ error: true, text: error.code === 'NOT_EARNED' ? 'هذا الإطار غير مملوك بعد.' : plusError(error) });
      if (error.code === 'CONFLICT') await wardrobe.reload();
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return <>
    <ProgressionStyles />
    <ProgressionProfile name={profile.name} bio={profile.bio} title={title} cover={cover} portrait={unframedPortrait} layeredPortrait={layeredPortrait}
      frameId={equippedProgression?.id} level={progress.level} xpIntoLevel={progress.xpIntoLevel}
      xpForNextLevel={progress.xpForNextLevel} owner={owner} achievements={badges}
      mastery={owner ? mastery : []} nextReward={nextReward && { ...nextReward, itemId: nextReward.id }}
      onCatalog={() => openWardrobe()} onReward={openWardrobe} onCustomize={onCustomize}
      onAchievement={badge => setDialog({ kind: 'achievement', item: badge })}
      onMastery={track => setDialog({ kind: 'mastery', item: track })} />
    {owner && dialog?.kind === 'wardrobe' && <Modal title="خزانة المقتنيات" placement="bottom" onClose={close}>
      {notice && <p role={notice.error ? 'alert' : 'status'}>{notice.text}</p>}
      {wardrobe.error && <p role="alert">تعذّر تحديث حقوق الإطار. <Button variant="ghost" onClick={wardrobe.reload}>إعادة التحميل</Button></p>}
      <div hidden={Boolean(selected)}><ProgressionCatalog items={items} portrait={unframedPortrait} onSelect={item => setChosen(item.id)} /></div>
      {selected && <div className="stack pc-wardrobe-preview">
        <ProgressionPortrait className="pc-catalog-art" name={profile.name} portrait={unframedPortrait} frameId={selected.id} />
        <strong>{selected.label}</strong>
        <p>المستوى {progressionNumber(selected.level)} · مكافأة دائمة من اللعب</p>
        <p>{selected.state === 'locked' ? (selected.level === 1 ? 'مقفل حتى أول جلسة مؤهلة' : 'مقفل حتى الوصول إلى المستوى ' + progressionNumber(selected.level)) : selected.state === 'equipped' ? 'مجهّز الآن' : 'مملوك'}</p>
        {selected.grantedAt && <time dateTime={new Date(selected.grantedAt).toISOString()}>تاريخ الحصول {new Date(selected.grantedAt).toLocaleDateString('ar-JO')}</time>}
        {selected.state === 'owned' && <Button variant="accent" disabled={!wardrobe.data || saving} loading={saving} onClick={() => apply(selected.id)}>تجهيز الإطار</Button>}
        <Button variant="ghost" disabled={saving} onClick={() => setChosen(null)}>العودة إلى المقتنيات</Button>
      </div>}
      {previousFrame !== undefined && previousFrame !== equippedId && <Button disabled={!wardrobe.data || saving} variant="ghost" onClick={() => apply(previousFrame, true)}>إعادة الإطار السابق</Button>}
    </Modal>}
    {dialog?.kind === 'achievement' && <Modal title={dialog.item.label} onClose={close} placement="bottom">
      <p>{dialog.item.description}</p>
      <p>إنجاز مكتسب</p>
      {owner && <Button onClick={() => { close(); onCustomize?.(); }}>ترتيب الشارات واختيار اللقب</Button>}
    </Modal>}
    {owner && dialog?.kind === 'mastery' && <Modal title="مسار الإتقان" onClose={close} placement="bottom">
      <p>الإتقان {progressionNumber(dialog.item.grade)} من {progressionNumber(dialog.item.maxGrade)}.</p>
      <p>{progressionNumber(dialog.item.completed)} مباراة مؤهلة في هذا المسار.</p>
    </Modal>}
  </>;
}

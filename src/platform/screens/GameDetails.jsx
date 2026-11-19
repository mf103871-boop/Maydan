import { tr } from '../../shared/i18n/core.js';
// تفاصيل لعبة: «كيف تلعب» بخطوات متحركة، عدد اللاعبين والمدة، وزر العب.
import React from 'react';
import { Screen, TopBar, IconButton, Button, Card } from '../../shared/ui/components.jsx';
import { IconBack, IconUsers, IconClock, IconMotion, IconBook, IconInfo } from '../../shared/ui/icons.jsx';
import { usePlatform } from '../context.js';
import { navigate, back, getDirection, getRoute } from '../router.js';
import { getGame } from '../registry.js';
import { resolveGameMode, gameInstructionsNextPath } from '../game-mode-navigation.js';
import homeStyles from './home-rebuild.css';
import { MenuGameIcon } from '../MenuGameIcon.jsx';
import { getAvatarArt } from '../../shared/brand/playful-identity.js';
import { getPlayfulSceneArt } from '../../shared/brand/playful-scenes.js';
import { useI18n } from '../../shared/i18n/react.jsx';
import { gameName } from '../../shared/i18n/core.js';
import { RewardedEntry } from '../../shared/account/RewardedOffer.jsx';
import { LOCAL_REWARDED_OFFER } from '../../shared/account/rewarded.js';
import { useAccount } from '../../shared/account/context.js';
import { entryPolicyEnabled } from '../../shared/account/gameplay-policy.mjs';

// A concise drawing guide; the unchanged complete game rules remain in About.
const drawingSteps = [
  ['كل لاعب بحسابه وجهازه', 'أنشئ غرفة أو ادخل بدعوة.'],
  ['اختر فكرة من ثلاث ثم ارسمها', '١٠ ثوانٍ للاختيار، ودقيقة للرسم دون كتابة الحل أو نطقه.'],
  ['يخمّن الجميع معًا', 'تظهر التلميحات بعد ٣٠ و٤٥ ثانية.'],
  ['شخصان يتعاونان، ومن ثلاثة تبدأ المنافسة', 'حتى ٨ لاعبين، والسرعة تساعدكم.'],
  ['تتبادلون الرسم بعد كل كشف', 'لا تتكرر فكرة قديمة دون اختيار صريح.'],
];
function InstructionArt({ index, drawing }) {
  if (!drawing) return index === 0 ? <IconBook /> : <IconInfo />;
  if (index === 0) return <img className="instruction-avatar" src={getAvatarArt('human-02',84)} alt="" width="84" height="84"/>;
  if (index === 1) return <MenuGameIcon id="badeeha"/>;
  if (index === 3) return <span className="instruction-players"><img src={getAvatarArt('human-01',68)} alt="" width="60" height="68"/><img src={getAvatarArt('human-02',68)} alt="" width="60" height="68"/></span>;
  return <img className={index === 2 ? 'instruction-chat' : 'instruction-turns'} src={getPlayfulSceneArt(index === 2 ? 'chat' : 'turns',128)} width="128" height="128" alt=""/>;
}

// معرّف غير معروف في الرابط: الملاحة أثناء التصيير تضيع لأن مستمعي الموجّه لم
// يشتركوا بعد، فتبقى الصفحة بيضاء إلى الأبد. نعرض رسالة وزر عودة بدلًا منها.
export function MissingGame({ id }) {
  return (
    <Screen data-design-screen="game-details" dir={getDirection()} className="stack" aria-label={tr("لعبة غير موجودة")}>
      <TopBar data-design-id="topbar" title={tr("لعبة غير موجودة")} start={<IconButton data-design-id="back" label={tr("رجوع")} onClick={back}><IconBack /></IconButton>} />
      <Card className="stack">
        <span className="card-title">{tr("لا توجد لعبة بهذا المعرّف")}</span>
        <p className="card-muted">{tr("الرابط يشير إلى «")}<bdi>{id}</bdi>{tr("» ولا توجد لعبة بهذا الاسم في ميدان.")}</p>
        <Button data-design-id="home" variant="accent" size="lg" full onClick={() => navigate('/', { replace: true })}>{tr("العودة إلى الرئيسية")}</Button>
      </Card>
    </Screen>
  );
}

export function GameDetails({ id, mode: requestedMode }) {
  const { locale, number } = useI18n();
  const game = getGame(id);
  const { sound, haptics } = usePlatform();
  const account = useAccount();
  if (!game) return <MissingGame id={id} />;
  const mode = resolveGameMode(id, requestedMode ?? getRoute().params.mode);
  const modeLabel = game.id === 'ersomha' ? tr("أونلاين · تعاون لشخصين · منافسة من ثلاثة") : game.players.mode === 'teams' ? tr("فرق") : game.players.mode === 'both' ? tr("فردي أو فرق") : tr("فردي");
  const factDelay = (i) => ({ '--delay': `${250 + i * 50}ms` });
  const note = entryPolicyEnabled(account.gameplayPolicy)
    ? tr("أول مباراة كاملة لكل لعبة مجانية. بعدها تذكرة للمضيف أو بلس، بما فيها جميع حزم بديهة. تشمل التذكرة كل جولات المباراة؛ انضمام الضيوف إلى غرفة المضيف مجاني.")
    : account.gameplayPolicy
    ? game.id === 'badeeha' ? tr("عشر حزم أساسية مجانية دائمًا. للحزم الأخرى: مباراة أولى مجانية، ثم تذكرة إعلان اختياري أو بلس.") : tr("المباراة الأولى مجانية. بعدها يبدأ المضيف بتذكرة إعلان اختياري أو بلس؛ الانضمام إلى الغرف مجاني.")
    : game.id === 'badeeha' ? tr("كل الفئات مجانية — العبوا قد ما بدكم") : tr("اللعب واستضافة الغرف والانضمام مجانًا");
  const skip = () => {
    const target = gameInstructionsNextPath(game.id, requestedMode ?? getRoute().params.mode);
    if (!target) return;
    sound.play('whoosh'); haptics.vibrate('medium'); navigate(target);
  };
  return (
    <Screen data-design-screen="game-details" dir={getDirection()} className="stack game-instructions-screen" style={{ '--game-accent': game.accent }} aria-label={gameName(game,locale)}>
      <style>{homeStyles}</style>
      <TopBar data-design-id="topbar" title={gameName(game,locale)} start={<IconButton data-design-id="back" label={tr("رجوع")} onClick={back}><IconBack /></IconButton>} />
      {!mode && <p className="selected-game-mode" role="status">{tr("هذا النمط غير متاح لهذه اللعبة حاليًا")}</p>}
      <section className="game-instructions-steps" aria-labelledby="game-steps-title">
        <div className="instruction-hero"><h2 id="game-steps-title">{tr("طريقة اللعب")}</h2><MenuGameIcon id={game.id}/></div>
        <ol role="list" data-design-id="steps" className="steps">{game.howToPlay.map((s, i) => <li key={i} className="step"><span className="instruction-number" aria-hidden="true">{number(i + 1)}</span><span className="instruction-copy">{game.id === 'ersomha' ? <><strong>{tr(drawingSteps[i][0])}</strong><span>{tr(drawingSteps[i][1])}</span></> : tr(s)}</span><span className="instruction-icon" aria-hidden="true"><InstructionArt index={i} drawing={game.id === 'ersomha'}/></span></li>)}</ol>
      </section>
      <details data-design-id="hero" className="instruction-facts">
        <summary data-design-id="game-name"><IconInfo />{tr("عن اللعبة")}</summary>
        {game.id === 'ersomha' && <ol className="instruction-full-rules">{game.howToPlay.map(rule => <li key={rule}>{tr(rule)}</li>)}</ol>}
        <p data-design-id="game-description">{tr(game.description)}</p>
        <div data-design-id="facts" className="facts">
          <span className="fact" style={factDelay(0)}><IconUsers /> {game.players.min}–{game.players.max} · {modeLabel}</span>
          <span className="fact" style={factDelay(1)}><IconClock /> {tr(game.duration)}</span>
          {game.tags.map((t, i) => <span key={t} className="fact" style={factDelay(2 + i)}>#{tr(t)}</span>)}
        </div>
        <p className="card-muted">{note}</p>
      </details>
      <div data-design-id="actions" className="setup-sticky stack">
        <Button data-design-id="skip-instructions" variant="accent" size="lg" full icon={<IconMotion />} disabled={!mode} onClick={skip}>{mode === 'online' ? tr("إلى غرف اللعبة") : tr("إلى إعداد اللعبة")}</Button>
      </div>
      {typeof __MAYDAN_REWARDED_PREVIEW__ !== 'undefined' && __MAYDAN_REWARDED_PREVIEW__ && id === 'badeeha' && mode === 'local' &&
        <RewardedEntry offer={LOCAL_REWARDED_OFFER} onReady={() => navigate('/play/badeeha?mode=local&rewarded=1')} onFree={skip} />}
    </Screen>
  );
}

// تفاصيل لعبة: «كيف تلعب» بخطوات متحركة، عدد اللاعبين والمدة، وزر العب.
import React from 'react';
import { Screen, TopBar, IconButton, Button, Card } from '../../shared/ui/components.jsx';
import { IconBack, IconUsers, IconClock, IconMotion, IconBook, IconInfo, IconTrophy } from '../../shared/ui/icons.jsx';
import { usePlatform } from '../context.js';
import { navigate, back, getDirection, getRoute } from '../router.js';
import { getGame } from '../registry.js';
import { resolveGameMode, gameInstructionsNextPath } from '../game-mode-navigation.js';
import homeStyles from './home-rebuild.css';
import { RewardedEntry } from '../../shared/account/RewardedOffer.jsx';
import { LOCAL_REWARDED_OFFER } from '../../shared/account/rewarded.js';
import { useAccount } from '../../shared/account/context.js';
import { entryPolicyEnabled } from '../../shared/account/gameplay-policy.mjs';

// معرّف غير معروف في الرابط: الملاحة أثناء التصيير تضيع لأن مستمعي الموجّه لم
// يشتركوا بعد، فتبقى الصفحة بيضاء إلى الأبد. نعرض رسالة وزر عودة بدلًا منها.
export function MissingGame({ id }) {
  return (
    <Screen data-design-screen="game-details" dir={getDirection()} className="stack" aria-label="لعبة غير موجودة">
      <TopBar data-design-id="topbar" title="لعبة غير موجودة" start={<IconButton data-design-id="back" label="رجوع" onClick={back}><IconBack /></IconButton>} />
      <Card className="stack">
        <span className="card-title">لا توجد لعبة بهذا المعرّف</span>
        <p className="card-muted">الرابط يشير إلى «<bdi>{id}</bdi>» ولا توجد لعبة بهذا الاسم في ميدان.</p>
        <Button data-design-id="home" variant="accent" size="lg" full onClick={() => navigate('/', { replace: true })}>العودة إلى الرئيسية</Button>
      </Card>
    </Screen>
  );
}

export function GameDetails({ id, mode: requestedMode }) {
  const game = getGame(id);
  const { sound, haptics } = usePlatform();
  const account = useAccount();
  if (!game) return <MissingGame id={id} />;
  const mode = resolveGameMode(id, requestedMode ?? getRoute().params.mode);
  const modeLabel = game.id === 'ersomha' ? 'أونلاين · تعاون لشخصين · منافسة من ثلاثة' : game.players.mode === 'teams' ? 'فرق' : game.players.mode === 'both' ? 'فردي أو فرق' : 'فردي';
  const factDelay = (i) => ({ '--delay': `${250 + i * 50}ms` });
  const note = entryPolicyEnabled(account.gameplayPolicy)
    ? 'أول مباراة كاملة لكل لعبة مجانية. بعدها تذكرة للمضيف أو بلس، بما فيها جميع حزم بديهة. تشمل التذكرة كل جولات المباراة؛ انضمام الضيوف إلى غرفة المضيف مجاني.'
    : account.gameplayPolicy
    ? game.id === 'badeeha' ? 'عشر حزم أساسية مجانية دائمًا. للحزم الأخرى: مباراة أولى مجانية، ثم تذكرة إعلان اختياري أو بلس.' : 'المباراة الأولى مجانية. بعدها يبدأ المضيف بتذكرة إعلان اختياري أو بلس؛ الانضمام إلى الغرف مجاني.'
    : game.id === 'badeeha' ? 'كل الفئات مجانية — العبوا قد ما بدكم' : 'اللعب واستضافة الغرف والانضمام مجانًا';
  const skip = () => {
    const target = gameInstructionsNextPath(game.id, requestedMode ?? getRoute().params.mode);
    if (!target) return;
    sound.play('whoosh'); haptics.vibrate('medium'); navigate(target);
  };
  return (
    <Screen data-design-screen="game-details" dir={getDirection()} className="stack game-instructions-screen" style={{ '--game-accent': game.accent }} aria-label={game.name}>
      <style>{homeStyles}</style>
      <TopBar data-design-id="topbar" title={game.name} start={<IconButton data-design-id="back" label="رجوع" onClick={back}><IconBack /></IconButton>} />
      {!mode && <p className="selected-game-mode" role="status">هذا النمط غير متاح لهذه اللعبة حاليًا</p>}
      <section className="game-instructions-steps" aria-labelledby="game-steps-title">
        <h2 className="section-title" id="game-steps-title">طريقة اللعب</h2>
        <ol role="list" data-design-id="steps" className="steps">{game.howToPlay.map((s, i) => <li key={i} className="step" style={{ '--delay': `${i * 45}ms` }}><span className="instruction-number" aria-hidden="true">{i + 1}</span><span className="instruction-icon" aria-hidden="true">{i === 0 ? <IconBook /> : i === game.howToPlay.length - 1 ? <IconTrophy /> : <IconInfo />}</span>{s}</li>)}</ol>
      </section>
      <div data-design-id="actions" className="setup-sticky stack">
        <Button data-design-id="skip-instructions" variant="accent" size="lg" full icon={<IconMotion />} disabled={!mode} onClick={skip}>{mode === 'online' ? 'إلى غرف اللعبة' : 'إلى إعداد اللعبة'}</Button>
      </div>
      {typeof __MAYDAN_REWARDED_PREVIEW__ !== 'undefined' && __MAYDAN_REWARDED_PREVIEW__ && id === 'badeeha' && mode === 'local' &&
        <RewardedEntry offer={LOCAL_REWARDED_OFFER} onReady={() => navigate('/play/badeeha?mode=local&rewarded=1')} onFree={skip} />}
      <details data-design-id="hero" className="instruction-facts">
        <summary data-design-id="game-name">عن {game.name}</summary>
        <p data-design-id="game-description">{game.description}</p>
        <div data-design-id="facts" className="facts">
          <span className="fact" style={factDelay(0)}><IconUsers /> {game.players.min}–{game.players.max} · {modeLabel}</span>
          <span className="fact" style={factDelay(1)}><IconClock /> {game.duration}</span>
          {game.tags.map((t, i) => <span key={t} className="fact" style={factDelay(2 + i)}>#{t}</span>)}
        </div>
        <p className="card-muted">{note}</p>
      </details>
    </Screen>
  );
}

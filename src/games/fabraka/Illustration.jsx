import React, { useEffect, useState } from 'react';
import { Button, Modal } from '../../shared/ui/components.jsx';
import { resolveMedia } from '../../shared/media/resolve.js';
import { pictureAsset, PICTURE_CREDIT } from './pictureAssets.js';

function Picture({ src, description }) {
  const [status, setStatus] = useState('loading');
  const [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState(false);
  // A failed 200 image may have been cached. The worker refreshes this one asset
  // and stores the repaired response at its canonical URL for later offline use.
  const imageSrc = attempt ? `${src}${src.includes('?') ? '&' : '?'}fabRetry=${attempt}` : src;
  useEffect(() => {
    if (status !== 'loading') return undefined;
    const timer = setTimeout(() => setStatus('error'), 20000);
    return () => clearTimeout(timer);
  }, [status, attempt]);
  const retry = () => { setStatus('loading'); setAttempt((value) => value + 1); };
  return <figure className="fab-illustration">
    <div className={`fab-picture-stage is-${status}`} aria-busy={status === 'loading'}>
      <button type="button" className="fab-picture-open" aria-label="تكبير صورة الأداة" disabled={status !== 'ready'} onClick={() => setExpanded(true)}>
        <img key={attempt} src={imageSrc} alt={description} decoding="async" draggable="false"
          onLoad={() => setStatus('ready')} onError={() => setStatus('error')} />
        {status === 'ready' && <span className="fab-picture-zoom" aria-hidden="true">تكبير ↗</span>}
      </button>
      {status === 'loading' && <p className="fab-picture-status" role="status">جارٍ تحميل الصورة…</p>}
      {status === 'error' && <div className="fab-picture-status stack"><p role="alert">تعذّر تحميل الصورة. تحقّق من الاتصال ثم أعد المحاولة.</p><Button variant="secondary" onClick={retry}>إعادة تحميل الصورة</Button></div>}
    </div>
    <figcaption>{PICTURE_CREDIT}</figcaption>
    {expanded && <Modal title="صورة الأداة" className="fab-picture-modal" onClose={() => setExpanded(false)} closeLabel="إغلاق الصورة المكبّرة">
      <img className="fab-picture-full" src={imageSrc} alt={description} draggable="false" />
      <p className="fab-picture-credit">{PICTURE_CREDIT}</p>
    </Modal>}
  </figure>;
}

export function Illustration({ question }) {
  const asset = pictureAsset(question);
  if (!asset) return <p className="fab-note" role="alert">صورة هذه الجولة غير متاحة. ابدأوا جلسة جديدة للحصول على الصور المحدّثة.</p>;
  const src = resolveMedia(asset);
  return <Picture key={src} src={src} description={question.imageDescription || 'أداة ذات شكل غير مألوف على خلفية محايدة'} />;
}

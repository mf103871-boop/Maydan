import { tr } from '../shared/i18n/core.js';
import React, { useEffect, useState } from 'react';
import { useAccount } from '../shared/account/context.js';
import { reviewPreviewPath } from './client.js';

export function ReviewImage({ path, label = tr("الصورة المرسلة للمراجعة"), onReady }) {
  const account = useAccount();
  const userId = account.signedIn ? account.user?.id : null;
  const requestAuthenticated = account.requestAuthenticated;
  const [preview, setPreview] = useState(null);
  const [retry, setRetry] = useState(0);
  const validPath = reviewPreviewPath(path);
  useEffect(() => {
    let alive = true; let objectUrl = null;
    onReady?.(false);
    if (!userId || !validPath) return undefined;
    setPreview(null);
    (async () => {
      try {
        const response = await requestAuthenticated(validPath, { raw: true });
        const blob = await response.blob();
        if (!alive) return;
        if (blob.type !== 'image/jpeg') throw new Error('invalid preview');
        objectUrl = URL.createObjectURL(blob); setPreview({ userId, path: validPath, url: objectUrl });
      } catch { if (alive) setPreview({ userId, path: validPath, error: true }); }
    })();
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [userId, validPath, requestAuthenticated, retry, onReady]);
  const shown = preview?.userId === userId && preview?.path === validPath ? preview : null;
  if (!userId || !validPath) return null;
  const failed = () => {
    onReady?.(false);
    setPreview(current => current?.url === shown?.url ? { userId, path: validPath, error: true } : current);
  };
  const decoded = async event => {
    const image = event.currentTarget;
    try { await image.decode?.(); }
    catch { if (image.isConnected) failed(); return; }
    if (image.isConnected && image.src === shown.url && image.naturalWidth > 0) onReady(true);
  };
  return <div className="review-image">{shown?.url ? <img key={onReady ? shown.url : undefined} src={shown.url} alt={label} onLoad={onReady ? decoded : undefined} onError={onReady ? failed : undefined} /> : shown?.error ? <div role="status"><p>{tr("تعذّر تحميل المعاينة.")}</p><button type="button" data-design-id="review-image-retry" className="review-retry" onClick={() => setRetry(value => value + 1)}>{tr("إعادة المحاولة")}</button></div> : <p role="status">{tr("جارٍ تحميل معاينة خاصة…")}</p>}</div>;
}

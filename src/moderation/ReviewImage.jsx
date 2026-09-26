import React, { useEffect, useState } from 'react';
import { useAccount } from '../shared/account/context.js';
import { reviewPreviewPath } from './client.js';

export function ReviewImage({ path, label = 'الصورة المرسلة للمراجعة' }) {
  const account = useAccount();
  const userId = account.signedIn ? account.user?.id : null;
  const requestAuthenticated = account.requestAuthenticated;
  const [preview, setPreview] = useState(null);
  const [retry, setRetry] = useState(0);
  const validPath = reviewPreviewPath(path);
  useEffect(() => {
    let alive = true; let objectUrl = null;
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
  }, [userId, validPath, requestAuthenticated, retry]);
  const shown = preview?.userId === userId && preview?.path === validPath ? preview : null;
  if (!userId || !validPath) return null;
  return <div className="review-image">{shown?.url ? <img src={shown.url} alt={label} /> : shown?.error ? <div role="status"><p>تعذّر تحميل المعاينة.</p><button type="button" className="review-retry" onClick={() => setRetry(value => value + 1)}>إعادة المحاولة</button></div> : <p role="status">جارٍ تحميل معاينة خاصة…</p>}</div>;
}

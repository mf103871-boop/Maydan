import { tr } from '../shared/i18n/core.js';
import React, { useState } from 'react';
import { ReviewImage } from '../moderation/ReviewImage.jsx';

export function ImageReviewStatus({ review, kind }) {
  const [preview, setPreview] = useState(false);
  if (!review || !['pending', 'rejected', 'removed'].includes(review.status)) return null;
  const name = kind === 'cover' ? tr("الغلاف") : tr("الصورة الشخصية");
  return <div className={'profile-image-review is-' + review.status}>
    <p role="status"><b>{review.status === 'pending' ? tr("{v0} الجديدة بانتظار المراجعة", {v0: name}) : review.status === 'rejected' ? tr("لم تُقبل {v0} الجديدة", {v0: name}) : tr("أُزيلت {v0} بعد المراجعة", {v0: name})}</b></p>
    <p>{review.status === 'pending' ? tr("تم رفعها بنجاح. تراجعها إدارة ميدان قبل ظهورها للآخرين، ولا تحتاج إلى إعادة رفعها. تبقى النسخة المعتمدة السابقة ظاهرة إن وُجدت.") : review.status === 'rejected' ? tr("يمكنك رفع صورة أخرى مناسبة. تبقى النسخة المعتمدة السابقة إن وُجدت.") : tr("يمكنك اختيار شخصية جاهزة أو إرسال صورة أخرى للمراجعة.")}</p>
    {review.rejectionReason && <p dir="auto">{tr("سبب القرار: ")}{review.rejectionReason}</p>}
    {review.previewUrl && <><button type="button" className="profile-review-toggle" aria-expanded={preview} onClick={() => setPreview(value => !value)}>{preview ? tr("إخفاء الصورة المرسلة") : tr("معاينة صورتي المرسلة")}</button>{preview && <ReviewImage path={review.previewUrl} label={name + tr(" المرسلة، معاينة خاصة")} />}</>}
  </div>;
}

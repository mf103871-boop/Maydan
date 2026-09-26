import React, { useState } from 'react';
import { ReviewImage } from '../moderation/ReviewImage.jsx';

export function ImageReviewStatus({ review, kind }) {
  const [preview, setPreview] = useState(false);
  if (!review || !['pending', 'rejected', 'removed'].includes(review.status)) return null;
  const name = kind === 'cover' ? 'الغلاف' : 'الصورة الشخصية';
  return <div className={'profile-image-review is-' + review.status}>
    <p role="status"><b>{review.status === 'pending' ? `${name} الجديدة بانتظار المراجعة` : review.status === 'rejected' ? `لم تُقبل ${name} الجديدة` : `أُزيلت ${name} بعد المراجعة`}</b></p>
    <p>{review.status === 'pending' ? 'تظهر للآخرين بعد اعتمادها. تبقى النسخة المعتمدة السابقة ظاهرة إن وُجدت.' : review.status === 'rejected' ? 'يمكنك رفع صورة أخرى مناسبة. تبقى النسخة المعتمدة السابقة إن وُجدت.' : 'يمكنك اختيار شخصية جاهزة أو إرسال صورة أخرى للمراجعة.'}</p>
    {review.rejectionReason && <p dir="auto">سبب القرار: {review.rejectionReason}</p>}
    {review.previewUrl && <><button type="button" className="profile-review-toggle" aria-expanded={preview} onClick={() => setPreview(value => !value)}>{preview ? 'إخفاء الصورة المرسلة' : 'معاينة صورتي المرسلة'}</button>{preview && <ReviewImage path={review.previewUrl} label={name + ' المرسلة، معاينة خاصة'} />}</>}
  </div>;
}

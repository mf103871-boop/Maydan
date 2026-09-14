// صفحة التحويلة في كومنز تُرجع بيانات ملف آخر تحت الاسم المطلوب، فكان `--from`
// ينزّل صورة لا علاقة لها بالسؤال وينسبها للاسم المطلوب بصمت. أُثبت ذلك حيًّا:
// «File:Flag of the Cocos (Keeling) Islands.svg» تعيد Flag_of_Australia_(converted).svg.
import test from 'node:test';
import assert from 'node:assert/strict';
import { commonsFileTitle, commonsRedirect } from '../scripts/media-fetch.mjs';

const info = (name) => ({ descriptionurl: `https://commons.wikimedia.org/wiki/File:${name}` });

test('اسم الملف يُقرأ من descriptionurl لا من الاسم المطلوب', () => {
  assert.equal(commonsFileTitle(info('Flag_of_Australia_(converted).svg')), 'File:Flag of Australia (converted).svg');
  assert.equal(commonsFileTitle(info('Flag%20of%20Colombia.svg')), 'File:Flag of Colombia.svg');
  assert.equal(commonsFileTitle({}), null);
  assert.equal(commonsFileTitle(null), null);
});

test('التحويلة تُرفض ويُذكر اسم الملف الحقيقي', () => {
  const message = commonsRedirect('File:Flag of the Cocos (Keeling) Islands.svg', info('Flag_of_Australia_(converted).svg'));
  assert.ok(message, 'كان يجب رفض التحويلة');
  assert.match(message, /Flag of Australia \(converted\)\.svg/);
  assert.match(message, /Cocos/);
});

test('الملف المطابق يمرّ، والشرطة السفلية والترميز لا يُعدّان اختلافًا', () => {
  assert.equal(commonsRedirect('File:Flag of Colombia.svg', info('Flag_of_Colombia.svg')), null);
  assert.equal(commonsRedirect('File:Flag_of_Colombia.svg', info('Flag%20of%20Colombia.svg')), null);
  assert.equal(commonsRedirect('file:flag of colombia.svg', info('Flag_of_Colombia.svg')), null);
});

test('غياب descriptionurl لا يُسقط الجلب', () => {
  assert.equal(commonsRedirect('File:Anything.svg', { url: 'https://upload.wikimedia.org/x.svg' }), null);
});

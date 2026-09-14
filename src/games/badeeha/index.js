// manifest لعبة «بَديهة»: تدير إعداد الفرق بنفسها (setup: 'self') ولا ترتبط بدفتر اللاعبين.
import React from 'react';
import meta from './meta.js';
import MaydanBeta from './App.js';
import { BadeehaIcon } from './icon.jsx';
import { migrateLegacyKeys } from './keys.js';
import { CATS } from '../../data/categories/index.js';
import { collectCredits } from '../../shared/media/resolve.js';

// ترحيل مفاتيح نسخة «ميدان» التجريبية عند أول تحميل، قبل أن تقرأ اللعبة مخزنها.
migrateLegacyKeys();

// تُمرَّر كامل خصائص شاشة اللعب (وأهمها api) إلى اللعبة: بدونها كانت إعدادات
// الصوت والاهتزاز و«حركة أقل» في المنصة لا تصل إلى بَديهة، ولم تستطع اللعبة
// إخبار المنصة متى تكون مباراة جارية.
function Game(props) {
  return React.createElement(MaydanBeta, props);
}

export default {
  ...meta,
  icon: BadeehaIcon,
  Component: Game,
  exitMessage: 'تُحفظ المباراة تلقائيًا، ويمكنك متابعتها لاحقًا من شاشة بَديهة.',
  // إسناد كل ملف وسائط في الحزم (صورة/صوت) — تعرضه شاشة «المصادر والتراخيص» في «حول».
  credits: collectCredits(CATS),
};

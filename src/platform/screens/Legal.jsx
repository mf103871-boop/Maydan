// شروط الاستخدام وسياسة الخصوصية: صفحتان داخل التطبيق (#/terms و#/privacy) يصل إليهما
// جدار «ميدان بلس» والإعدادات وصفحة «عن ميدان»، وروابطهما العامة تُستعمل في المتاجر.
import React from 'react';
import { Screen, TopBar, IconButton, Card } from '../../shared/ui/components.jsx';
import { IconBack } from '../../shared/ui/icons.jsx';
import { back, getDirection } from '../router.js';
import { PLUS_NAME, SUPPORT_EMAIL, LEGAL_UPDATED } from '../../shared/account/config.js';

const Section = ({ title, children }) => (
  <Card className="stack legal-section">
    <span className="card-title">{title}</span>
    {children}
  </Card>
);

function Contact() {
  return SUPPORT_EMAIL
    ? <p className="card-muted">للتواصل: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.</p>
    : <p className="card-muted">للتواصل: عبر صفحة الدعم المرتبطة بالتطبيق في المتجر.</p>;
}

export function Terms() {
  return (
    <Screen dir={getDirection()} className="stack legal" aria-label="شروط الاستخدام">
      <TopBar title="شروط الاستخدام" eyebrow="ميدان" start={<IconButton label="رجوع" onClick={back}><IconBack /></IconButton>} />
      <p className="muted" style={{ fontSize: 13 }}>آخر تحديث: {LEGAL_UPDATED}</p>
      <Section title="الخدمة">
        <p className="card-muted">ميدان منصة ألعاب جماعية عربية. باستخدامك التطبيق أو الموقع توافق على هذه الشروط. الألعاب مخصصة للتسلية بين الأصدقاء والعائلة، ولا تُقدَّم أي ضمانات بخصوص دقة محتوى الأسئلة.</p>
      </Section>
      <Section title="الحساب">
        <p className="card-muted">تسجيل الدخول اختياري ويتم عبر حساب Apple أو Google. أنت مسؤول عن الحفاظ على وصولك إلى حسابك. يمكنك حذف حسابك في أي وقت من الإعدادات، فتُحذف بياناته من خوادمنا نهائيًا.</p>
      </Section>
      <Section title={`اشتراك ${PLUS_NAME}`}>
        <p className="card-muted">{PLUS_NAME} اشتراك شهري أو سنوي يفتح كل فئات بَديهة، ومباريات بلا حدود في بقية الألعاب، وإنشاء غرف جماعية بلا حدود. يُعرض السعر ومدة الاشتراك قبل الشراء.</p>
        <p className="card-muted">يتجدد الاشتراك تلقائيًا ما لم يُلغَ قبل نهاية الفترة الحالية بأربع وعشرين ساعة على الأقل. يُدار الاشتراك ويُلغى من حساب App Store عند الشراء داخل تطبيق iOS، أو من بوابة إدارة الاشتراك عند الشراء عبر الموقع. إلغاء الاشتراك يوقف التجديد ويبقى الوصول حتى نهاية الفترة المدفوعة.</p>
        <p className="card-muted">يعمل الاشتراك على كل أجهزتك متى سجّلت الدخول بالحساب نفسه. المشتريات عبر App Store تخضع لشروط Apple، وطلبات الاسترداد تُقدَّم إلى Apple مباشرة.</p>
      </Section>
      <Section title="المحتوى المجاني">
        <p className="card-muted">عشر فئات في بَديهة مجانية دائمًا، وكل لعبة أخرى تُلعب مباراة كاملة واحدة مجانًا على الجهاز أو الحساب. الدخول إلى الغرف الجماعية برمز مجاني دائمًا.</p>
      </Section>
      <Section title="الاستخدام المقبول">
        <p className="card-muted">لا تستخدم المنصة لإساءة معاملة الآخرين أو لمحاولة الالتفاف على القفل أو التلاعب بالغرف. قد نوقف الحساب الذي يخالف ذلك.</p>
      </Section>
      <Section title="التغييرات">
        <p className="card-muted">قد نحدّث هذه الشروط؛ التاريخ أعلاه يبيّن آخر تحديث، والاستمرار في الاستخدام بعده يعني الموافقة.</p>
        <Contact />
      </Section>
    </Screen>
  );
}

export function Privacy() {
  return (
    <Screen dir={getDirection()} className="stack legal" aria-label="سياسة الخصوصية">
      <TopBar title="سياسة الخصوصية" eyebrow="ميدان" start={<IconButton label="رجوع" onClick={back}><IconBack /></IconButton>} />
      <p className="muted" style={{ fontSize: 13 }}>آخر تحديث: {LEGAL_UPDATED}</p>
      <Section title="ما نجمعه">
        <p className="card-muted"><b>بلا حساب:</b> لا نجمع أي بيانات شخصية. أسماء اللاعبين والنتائج والإعدادات تُحفظ على جهازك فقط.</p>
        <p className="card-muted"><b>مع حساب:</b> عند الدخول بحساب Apple أو Google نحفظ معرّف الحساب لدى المزوّد، والاسم والبريد الإلكتروني إن شاركتهما، ومعرّفًا داخليًا لحسابك. نحفظ أيضًا حالة اشتراكك (المنتج، تاريخ الانتهاء، هل يتجدد) وسجل المباريات المجانية المستهلكة لكل لعبة.</p>
        <p className="card-muted"><b>الغرف الجماعية:</b> أثناء الغرفة تُرسل أسماء اللاعبين وشخصياتهم وإجاباتهم وتصويتاتهم إلى الخادم لتنسيق اللعبة، وتُحذف مع انتهاء الغرفة.</p>
      </Section>
      <Section title="لماذا">
        <p className="card-muted">لتشغيل الحساب والاشتراك على كل أجهزتك، ولمنع إساءة استخدام المباريات المجانية، ولتنسيق الغرف الجماعية. لا نستخدم بياناتك للإعلانات ولا للتتبع عبر التطبيقات، ولا نبيعها لأحد.</p>
      </Section>
      <Section title="المدفوعات">
        <p className="card-muted">داخل تطبيق iOS تتم المدفوعات عبر Apple، ولا نرى بيانات بطاقتك. على الموقع تتم عبر Paddle بصفته بائع التجزئة المعتمد، ولا تصلنا بيانات الدفع. نتلقى من المزوّد حالة الاشتراك فقط.</p>
      </Section>
      <Section title="التخزين والأمان">
        <p className="card-muted">تُخزَّن بيانات الحساب على خوادم Cloudflare. رموز الجلسة تُحفظ مجزّأة ولا تُخزَّن كلمات مرور لأننا لا نستعملها. الاتصال كله مشفّر.</p>
      </Section>
      <Section title="حقوقك">
        <p className="card-muted">يمكنك حذف حسابك من الإعدادات في أي وقت، فتُحذف كل بياناته من خوادمنا فورًا ويُبطل ربط حساب Apple. «مسح البيانات» في الإعدادات يحذف ما هو على الجهاز. يمكنك طلب نسخة من بياناتك أو تصحيحها عبر التواصل معنا.</p>
      </Section>
      <Section title="الأطفال">
        <p className="card-muted">التطبيق مناسب للعائلة ولا يجمع بيانات من الأطفال عمدًا؛ إنشاء الحساب والشراء بيد البالغين.</p>
      </Section>
      <Section title="التغييرات والتواصل">
        <p className="card-muted">قد نحدّث هذه السياسة؛ التاريخ أعلاه يبيّن آخر تحديث.</p>
        <Contact />
      </Section>
    </Screen>
  );
}

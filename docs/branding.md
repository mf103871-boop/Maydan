# ميدان: ألعاب جمعتنا

هوية الإصدار 1.1، بتاريخ 2026-09-08، بناءً على طلب صاحب التطبيق إنشاء اسم وأيقونة احترافيين وتطبيقهما.

| الاستخدام | القيمة |
| --- | --- |
| اسم التطبيق الكامل | ميدان: ألعاب جمعتنا |
| تحت أيقونة الهاتف | ميدان |
| العنوان الفرعي للمتجر | تحديات وضحك للأصدقاء والعائلة |
| اللون الأساسي | `#0B0E1A` |
| اللون الذهبي | `#F5B82E` |
| المصدر المعتمد للأيقونة | `public/icons/icon-1024.png` |

الكأس الذهبي يجمع دلالة التحدي والاجتماع، مع نجمة مفرغة وخلفية كحلية. صُمّم الأصل بأداة توليد الصور المدمجة، ثم جُهّز تقنيًا بالمقاسات اللازمة؛ لا يوجد نص داخل الأيقونة لتبقى واضحة عند التصغير. المصدر PNG مربع 1024×1024، بلا شفافية أو زوايا خارجية مستديرة.

يشغّل `npm run brand:icons` توليد أيقونات الموقع وPWA وينسخ الأصل إلى iOS. يشغّل `npm run ios:prepare` بناء محتوى اللعبة وتوليد مقاسات Xcode من أصل iOS. الصورتان الأصليتان في الموقع وiOS متطابقتان.

طُبّق الاسم والرسم في شاشة الافتتاح والرئيسية والتعريف، وأيقونات المتصفح والتثبيت، واسم iOS الظاهر. معرّف التطبيق `Maydan` ورقم Apple `6808385717` وفريقه `96WJBK2MB2` كما هي. الاسم الحالي المنشور «منصه ميدان»؛ الاسم الجديد ونص التحديث في `ios/app-store.json` جاهزان لإدخال بيانات الإصدار، ولا يعني حفظهما أن تحديثًا أُرسل إلى Apple.

## وصف التوليد

الأداة: built-in image generation؛ لم يُستخدم CLI أو مفتاح API خارجي.

```text
Use case: logo-brand
Asset type: final production iOS App Store icon and PWA icon for an Arabic social party-game app named “ميدان: ألعاب جمعتنا” (Maydan).
Create one exceptionally polished, original, premium app icon. Full-bleed square 1024×1024 opaque dark midnight navy (#0B0E1A) background, with a very subtle navy radial glow. A single bold sculpted golden emblem at the center: a contemporary trophy whose broad rounded cup and generous open handles subtly evoke friends gathered around a shared game. Geometric, balanced, welcoming, memorable silhouette, thick clean forms, sophisticated warm gold (#F5B82E) with restrained satin highlights and subtle dimensional depth. A small crisp four-point star cut out as navy negative space in the upper cup gives the emblem a unique signature. Integrated short pedestal, beautiful proportions, emblem occupies about 64% of the square, centered optically with plentiful safe space. Recognizable instantly at 32 pixels. Match a premium navy-and-gold game interface. Minimal visual elements, strong contrast, professional design studio finish.
Constraints: deliver only the square icon artwork, no mockup or device, no outer frame, no rounded outer corners, no border, no transparency, no lettering, no words, no numerals, no watermark, no laurel wreath, no people illustrations, no piles of objects, no tiny ornament, no exaggerated metallic reflections.
```

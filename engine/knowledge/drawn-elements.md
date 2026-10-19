# عناصر مرسومة بالكود — أسلوب بوابة المستثمر المعتمد

قاعدة العميل: **«نولّد الأشياء ونصوّر الناس»** — الأشياء (بوصلة، مفتاح، ختم، ملف، لوح مشبك، أوراق، جوال، تقويم، ميزان…)
تُرسم بالكود بإحساس مادي حقيقي؛ الأشخاص صور حقيقية فقط (لا ترسم وجوه أو أشخاص).

## الإحساس
- مادي وفاخر وهادئ: نحاس/ذهب مصقول بتدرجات مائلة، ورق عاجي، حبر بني، زجاج خفيف — **مو فلات/كرتوني ومو لامع CGI**.
- ظل تلامس ناعم تحت العنصر + `drop-shadow` بني دافئ (`rgba(60,45,20,.35)`)، وإضاءة من فوق يسار.
- تفاصيل دقيقة صادقة (تدريج البوصلة، أسنان المفتاح، خيط البطاقة، حلقة الختم المنقطة، أسطر الورق) — بدون زخرفة زايدة.
- **بدون نص** داخل العنصر إلا لو مطلوب حرفياً (المحرك يضيف النصوص). أرقام/رموز عامة مسموحة (®، ✓، تدريج).
- الخلفية **شفافة** دائماً — العنصر وحده.

## الألوان
عاجي `#F4F1E9` · ورق `#FBF7EE` / `#FFFDF7` · حبر `#24201A` · بني `#4A4135` · ذهب الهوية `#8C734B` / فاتح `#C9AE7C` / غامق `#6E5A33` ·
رمادي الهوية `#6D6E71` · أصفر التنبيه `#EFBF04` (قليل) · فحمي `#26272A`. حبر الأختام: بني ذهبي `#8C734B` أو أكسيد `#8E3329` (قليل).

## تقنيات معتمدة (من تصاميم منشورة)
```html
<!-- نحاس مصقول (BRASS) -->
<linearGradient id="b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F3E2B6"/><stop offset=".35" stop-color="#C9AE7C"/>
 <stop offset=".6" stop-color="#8C734B"/><stop offset=".8" stop-color="#D8BE8A"/><stop offset="1" stop-color="#6E5A33"/></linearGradient>
```
```css
/* حلقة البوصلة: معدن بتدرج مخروطي + قناع حلقة */
.bezel{border-radius:50%;background:conic-gradient(from 200deg,#5E4C2A,#C9AE7C 8%,#F2E2B8 14%,#9C8352 24%,#6E5A33 34%,#D6BC88 46%,#F6E8C4 52%,#A88E5C 62%,#5E4C2A 72%,#BFA372 84%,#EEDDB2 90%,#5E4C2A);
 -webkit-mask-image:radial-gradient(circle,transparent 219px,#000 220px);box-shadow:inset 0 0 0 1.5px rgba(40,30,12,.55)}
/* وجه عاجي غائر */
.dial{border-radius:50%;background:radial-gradient(circle at 45% 40%,#FFFEFA 0%,#F7F2E7 55%,#E9E0CC 100%);box-shadow:inset 0 6px 18px rgba(60,45,20,.28)}
/* لمعة زجاج */
.glass{border-radius:50%;background:radial-gradient(ellipse 60% 40% at 34% 22%,rgba(255,255,255,.55),transparent 70%)}
/* لوح مشبك */
.clip{border-radius:30px;background:linear-gradient(160deg,#A68B5E 0%,#8C734B 45%,#6E5A33 100%);
 box-shadow:0 50px 70px -30px rgba(60,45,20,.6),inset 0 2px 0 rgba(255,240,210,.35)}
.clamp{border-radius:18px 18px 26px 26px;background:linear-gradient(180deg,#E9E4DA 0%,#BDB6A8 45%,#8F897D 100%);box-shadow:0 10px 16px -8px rgba(0,0,0,.5),inset 0 2px 0 rgba(255,255,255,.7)}
/* ورقة */
.doc{border-radius:8px;background:linear-gradient(170deg,#FFFFFB,#F7F1E4);box-shadow:0 34px 50px -26px rgba(60,45,20,.6),0 6px 12px -6px rgba(60,45,20,.3)}
.ln{height:10px;border-radius:5px;background:#E3D9C4}   /* أسطر نص وهمية */
/* شريط لاصق */
.tape{background:linear-gradient(180deg,rgba(236,224,196,.88),rgba(222,206,170,.82));clip-path:polygon(3% 8%,97% 0,100% 92%,0 100%)}
```
- ختم ذهبي بارز: نجمة مسننة (polygon بـ 72 نقطة نصف قطر متناوب) بتدرج BRASS + دائرة radialGradient `#F6E7C0→#C9AE7C→#7E6538` + حلقة منقطة `stroke-dasharray="2 6"` + شريطين تحت.
- ختم حبر: دائرتين `stroke` بني + علامة ✓ عريضة، شفافية .85 وميلان −14°.
- مفتاح نحاسي: رأس دائري بفتحة + ساق + أسنان مستطيلة، كله BRASS، وبطاقة ورقية بخيط.

## مثال: ختم ذهبي (SVG كامل)
```html
<svg viewBox="0 0 300 380" width="300" height="380" style="overflow:visible;filter:drop-shadow(0 18px 16px rgba(60,45,20,.38))">
 <defs><linearGradient id="sg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F3E2B6"/><stop offset=".35" stop-color="#C9AE7C"/><stop offset=".6" stop-color="#8C734B"/><stop offset=".8" stop-color="#D8BE8A"/><stop offset="1" stop-color="#6E5A33"/></linearGradient>
 <radialGradient id="sg2" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#F6E7C0"/><stop offset=".55" stop-color="#C9AE7C"/><stop offset="1" stop-color="#7E6538"/></radialGradient></defs>
 <path d="M110 240 L80 370 L112 344 L140 372 L150 250 Z" fill="#6E5A33"/><path d="M190 240 L220 370 L188 344 L160 372 L150 250 Z" fill="#8C734B"/>
 <!-- polygon النجمة المسننة تُحسب بـ <script> أو تُكتب نقاطها -->
 <circle cx="150" cy="150" r="104" fill="url(#sg2)"/>
 <circle cx="150" cy="150" r="96" fill="none" stroke="#FFF4D6" stroke-opacity=".6" stroke-width="2"/>
 <circle cx="150" cy="150" r="86" fill="none" stroke="#6E5A33" stroke-opacity=".45" stroke-width="1.5" stroke-dasharray="2 6"/>
</svg>
```

## ممنوع
- أشخاص/وجوه/أيدي مرسومة · كرتون مسطح · ألوان خارج الهوية · نيون/توهج قوي · خلفية ملونة (لازم شفافة) · شعارات جهات حكومية أو علامات تجارية.

## ملاحظات من أول اختبار (بوصلة)
- الحروف والأرقام على الأوجه (N/E/S/W، التدريج) **ما يقطعها خط ولا علامة** — خلّ علامات التدريج تتوقف قبل الحرف بمسافة.
- الإطار النحاسي **سميك وبارز** (≥ 6% من القطر) بتدرّج مصقول ولمعة — مو حلقة رفيعة؛ والزجاج فوق الوجه بانعكاس قطري خفيف.

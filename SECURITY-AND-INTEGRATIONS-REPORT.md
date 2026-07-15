# تقرير الأمان والتكاملات — 16 يوليو 2026

## النتيجة التنفيذية

- يعمل تسجيل GitHub والدخول إلى جلسة التطبيق والـ API فعليًا.
- Google يصل إلى شاشة الموافقة ثم يرفض Supabase تبديل الرمز بسبب `invalid_client`: السر الحالي غير صحيح أو لا يطابق Client ID. يعرض الموقع الآن هذا السبب بالعربية بدل الرجوع الصامت إلى صفحة الدخول.
- أضيفت تكاملات GitHub وWhatsApp Cloud API خادمية، مع اختبار مباشر قبل الحفظ وتشفير بيانات الاعتماد وحدود طلبات وسجل تدقيق.
- Telegram بقي Webhook خادميًا كاملًا، وأصلحت الواجهة حالة عدم وجود مزود حتى لا تفتح قائمة هاتف فارغة.
- نُقلت Vercel Functions من `iad1` إلى `sin1` لتصبح أقرب إلى Supabase في `ap-southeast-1`.
- أضيف تقسيم صفحات الواجهة، وسياسة CSP، وعزل النوافذ والموارد، وتحسين دلالات حالة الجلسة.

## Google OAuth — الإجراء الخارجي المتبقي

لا يمكن تصحيح سر Google من الكود أو Supabase دون امتلاك قيمة السر داخل حساب Google. من Google Auth Platform افتح **نفس Web OAuth Client** ثم انسخ Client ID وClient Secret معًا إلى Supabase → Authentication → Providers → Google. إذا لم تعد قيمة السر متاحة، أنشئ Web Client جديدًا بهذه القيم:

- Authorized JavaScript origin: `https://moatazasaif.vercel.app`
- Authorized redirect URI: `https://bsmzknhkzepaqeffrfbc.supabase.co/auth/v1/callback`

لا تلصق Client Secret في محادثة أو GitHub أو متغير يبدأ بـ `VITE_`. بعد الحفظ، الاختبار الناجح هو: عدم ظهور `invalid_client` في Auth logs، ثم نجاح `/api/auth/me` بعد الرجوع إلى `/login`.

## نموذج حماية التكاملات

1. المتصفح يرسل التوكن مرة واحدة عبر HTTPS إلى Vercel Function مصادق عليها.
2. الخادم يختبر التوكن على مضيف ثابت (`api.github.com` أو `graph.facebook.com`) مع مهلة 15 ثانية وحد استجابة 1MB.
3. التوكن يُشفّر AES-256-GCM داخل `external_integrations.encrypted_credentials`.
4. أدوار `anon` و`authenticated` لا تملك صلاحية مباشرة على الجدول؛ الوصول عبر Service Role في الخادم فقط.
5. كل فحص أو إنشاء أو حذف أو إرسال تجريبي يُسجّل دون السر.

## ما يدعمه كل تكامل

| التكامل | الوظائف الحالية | بيانات الاعتماد الموصى بها |
|---|---|---|
| Telegram | تسجيل وفحص Webhook، ربط المحادثات، إرسال/استقبال، سياق AI | Bot Token من BotFather |
| GitHub | اختبار الحساب، حفظ مشفّر، تفعيل/تعطيل، عرض المستودعات المتاحة | Fine-grained PAT محدود المستودعات والصلاحيات |
| WhatsApp | اختبار Phone Number ID، حفظ مشفّر، إرسال رسالة نصية فعلية | Meta System User permanent token + Phone Number ID |

لأتمتة GitHub واسعة وطويلة الأجل استخدم GitHub App بدل PAT؛ Installation Token قصير العمر ويجب توليده خادميًا. استقبال رسائل WhatsApp يحتاج لاحقًا App Secret وVerify Token وWebhook موقعًّا من Meta؛ لم يُعرض كأنه يعمل قبل توفير تلك القيم.

## فحوص القاعدة والمنصة

- تم تطبيق migration جدول `external_integrations` بنجاح.
- مستشار Supabase الأمني لا يعرض ثغرات SQL جديدة. تنبيهات `RLS enabled no policy` معلوماتية ومقصودة للجداول الخادمية المسحوبة الصلاحيات.
- تحذير `Leaked Password Protection Disabled` ما زال قائمًا ويتطلب تفعيله من خطة Supabase التي تدعم الميزة.
- فهارس Telegram وMessages والتكاملات الجديدة قد تظهر `unused` لأنها جديدة أو قليلة الاستخدام؛ لا تُحذف قبل وجود بيانات تشغيل كافية.

## التحقق الآلي

- ESLint: ناجح.
- TypeScript للواجهة والـ API: ناجح.
- الاختبارات: 62/62 ناجحة.
- Vite production build: ناجح، والصفحات تُحمّل كحزم منفصلة.
- `/api/ready`: يعيد `status: ready`, `database: connected`, `rateLimit: ready` قبل هذا الإصدار.

## حدود صريحة

- لا يمكن اختبار GitHub PAT أو WhatsApp token حقيقيين دون أن يضيفهما مالك الحساب من صفحة التكاملات؛ الاختبارات الآلية تستخدم استجابات شبكية وهمية ولا تحتوي أسرارًا.
- MCP Servers ووضع Agent Loop لا يزالان غير مفعّلين؛ تفعليهما دون نموذج صلاحيات وأدوات محدد سيكون خطرًا.
- نسخة Sites واجهة اتصال منفصلة؛ لا تنقل cookies أو التوكنات من نطاق Vercel، وتوجّه العمليات الحساسة إلى الموقع الأساسي.

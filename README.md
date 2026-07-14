# معتز العلقمي — Moataz AI

نسخة إنتاجية لمنصة عربية على React/Vite + Vercel Functions + Supabase Auth/Postgres. تدعم هذه النسخة BYOK حقيقيًا بطريقتين: جلسة مؤقتة بلا قاعدة بيانات، أو حفظ مشفّر للمستخدم المسجل، مع محادثة حقيقية وبث موحّد لمزودات OpenAI-compatible وGemini وAnthropic.

## ما يعمل فعليًا

- تسجيل الدخول بالبريد أو اسم المستخدم وكلمة المرور.
- ملف `profiles` آمن كمصدر رسمي للأدوار: `owner`, `admin`, `supervisor`, `user`.
- لوحة إدارة للمستخدمين: إنشاء، تفعيل/إيقاف، تغيير الدور، إعادة تعيين كلمة مرور مؤقتة، وحذف بواسطة المالك.
- إنشاء حساب باسم مستخدم فقط عبر بريد داخلي لا يظهر للمستخدم.
- تهيئة المالك الأول رسميًا عبر Supabase Admin API، بدل الإدخال المباشر في `auth.users`.
- تخزين مفاتيح المزودات مشفّرة بـ AES-256-GCM من جهة الخادم، مع منع جدول المفاتيح من الوصول المباشر عبر المتصفح.
- Gemini وAnthropic ومزودات OpenAI-compatible، بما فيها OpenAI وOpenRouter وGroq وDeepSeek وMistral وTogether وNVIDIA.
- اكتشاف فعلي للنماذج، مع اختبار توليد بديل عندما لا يدعم المزود `/models`.
- تشخيص أخطاء المفتاح والصلاحية والرصيد وحد الطلبات والنموذج والبوابة والشبكة والمهلة وخادم المزود، مع عرض رسالة المزود الأصلية.
- حماية Base URL من SSRF عبر منع localhost والشبكات الخاصة والتحقق من DNS.
- محادثات ورسائل محفوظة في Supabase ومعزولة بسياسات RLS.
- تقييد ذري للطلبات داخل PostgreSQL لمسارات الدخول والإدارة والمزودات والمحادثة.
- `/api/health` و`/api/ready` للفحص التشغيلي؛ readiness يتحقق أيضًا من قاعدة البيانات وخدمة التقييد.

## وضعا BYOK

### جلسة مؤقتة (`credentialMode: session`)

- لا تحتاج إلى تسجيل الدخول أو Supabase.
- يظل المفتاح في `sessionStorage` فقط، ويُرسل داخل طلب Function الحالي فقط.
- لا يُنشأ صف في `providers`، ولا يُحفظ المفتاح أو رسائل الجلسة في Supabase.
- تُحفظ المحادثات المحلية في IndexedDB (`moataz-byok-local`) من دون حقل مفتاح.
- زر **مسح بيانات الجلسة** يحذف المفتاح والمحادثات المحلية.
- إغلاق سياق التصفح ينهي `sessionStorage` وفق سلوك المتصفح؛ يمكن للمستخدم المسح الفوري من الزر.

### حفظ مشفّر (`credentialMode: saved`)

- يتطلب JWT صالحًا وملكية الصف في `providers`.
- يُشفّر المفتاح في الخادم بـ AES-256-GCM باستخدام `ENCRYPTION_KEY` ولا يُعاد إلى الواجهة.
- تبقى المحادثات والرسائل في Supabase مع RLS وعزل المستخدمين.

لا تقبل `/api/chat` أو `/api/providers/test` خلط `providerId` مع كائن مزود مؤقت في الطلب نفسه؛ العقد مميّز بواسطة `credentialMode` ومتحقق منه بـ Zod.

## عقد المزودات والـ API

التعريف المركزي موجود في `shared/provider-registry.ts`، وهو المصدر الوحيد للنوع والاسم وBase URL الافتراضي والبروتوكول. يتضمن `dahl` كنوع OpenAI-compatible، إضافة إلى `custom` و`openai-compatible` المخصصين.

النقاط الأساسية:

- `POST /api/providers/test`: اختبار اتصال فعلي واكتشاف نماذج، ويعيد `detectedProtocol`, `models`, `testedModel`, `endpoint`, `httpStatus`, `latencyMs`, `category`, `providerMessage` (بعد التنقيح) و`hint`.
- `POST /api/chat`: يقبل الوضعين. مع `stream: true` يعيد أحداث SSE موحّدة: `meta`, `delta`, `usage`, `error`, `done`.
- المحولات الأصلية في `api/_lib/providers/`: لا يمر Gemini أو Anthropic عبر صيغة OpenAI بالخطأ.
- `assertSafeProviderUrl` يمنع HTTP/localhost والشبكات الداخلية في الإنتاج، ويُبقي `ALLOW_INSECURE_PROVIDER_URLS=false` افتراضيًا.

لا تُسجّل مفاتيح API أو ترويسات Authorization أو أجسام الطلبات السرية. التنقيح المركزي في `api/_lib/redaction.ts` يُستخدم في الأخطاء التقنية والتشخيص.

GitHub وMCP ووضع الوكيل معروضة كميزات غير مفعلة، بينما Telegram له مسار Webhook خادمي منفصل موضح أدناه.

## إعداد قاعدة البيانات

1. أنشئ مشروع Supabase.
2. نفّذ `supabase/schema.sql` كاملًا في SQL Editor لمشروع جديد.
3. للمشاريع الموجودة، نفّذ migration القابل لإعادة التشغيل `supabase/migrations/20260714190000_byok_provider_protocol.sql` بعد المخطط القديم. يضيف `protocol` ويستبدل قيد النوع الصلب بقيد آمن يسمح بـ `dahl` والأنواع المركزية.
4. انسخ `.env.example` إلى `.env.local` للتطوير، وأضف القيم نفسها في Vercel دون رفع الأسرار إلى GitHub.

## تهيئة المالك الأول

اضبط مؤقتًا:

```env
BOOTSTRAP_OWNER_EMAIL=mtzallqmy@gmail.com
BOOTSTRAP_OWNER_PASSWORD=كلمة-مؤقتة-قوية
BOOTSTRAP_TOKEN=رمز-عشوائي-طويل-جداً
```

بعد النشر نفّذ:

```bash
curl -X POST https://YOUR_DOMAIN/api/setup/bootstrap \
  -H 'Content-Type: application/json' \
  -H 'X-Bootstrap-Token: YOUR_LONG_TOKEN' \
  -d '{}'
```

بعد نجاح الطلب، احذف `BOOTSTRAP_TOKEN` و`BOOTSTRAP_OWNER_PASSWORD` من Vercel وأعد النشر. سيُطلب من المالك تغيير كلمة المرور عند أول دخول.

إذا كان البريد موجودًا مسبقًا في Supabase Auth، يمكن تشغيل `supabase/execute-bootstrap.sql` لترقيته فقط. لا ينشئ هذا SQL مستخدمًا ولا يغيّر كلمة المرور.

## التشغيل المحلي

```bash
npm ci
cp .env.example .env.local
npx vercel dev
```

`npm run dev` يشغّل واجهة Vite فقط؛ استخدم `vercel dev` لتشغيل الواجهة وVercel Functions معًا محليًا. وضع الجلسة يعمل حتى عند ترك متغيرات Supabase فارغة؛ مسارات الحساب/الحفظ تحتاج إعداد Supabase الكامل.

### اختبار محلي يدوي

1. اضبط `ALLOW_INSECURE_PROVIDER_URLS=true` فقط إذا كنت تختبر مزودًا محليًا عبر HTTP، ولا تستخدمه في الإنتاج.
2. افتح `/providers` ثم اختر **جلسة مؤقتة — لا يتم الحفظ**، أدخل النوع وBase URL والمفتاح والنموذج الاختياري، واضغط **اختبار واكتشاف النماذج**.
3. تحقق من Endpoint وHTTP Status والزمن والنماذج، ثم ابدأ محادثة من `/chat` وتحقق من وصول `delta` تدريجيًا.
4. افتح DevTools وتأكد أن المفتاح لا يظهر في URL أو HTML أو استجابة API؛ سيظهر فقط في جسم طلب POST الحالي إلى Function.
5. أغلق التبويب أو استخدم **مسح بيانات الجلسة**، ثم تحقق من اختفاء المفتاح وIndexedDB المحلية.
6. مع إعداد Supabase، سجّل الدخول واختر **حفظ مشفّر في الحساب**. افحص أن `GET /api/providers` يعيد بيانات وصفية فقط، وأن `encrypted_key` لا يظهر في Network response.

### الاختبارات الآلية

```bash
npm run lint
npm run typecheck
npm run typecheck:api
npm run test
npm run build
```

الاختبارات تستخدم `fetch` وIndexedDB وهميين ولا تحتاج مفاتيح مزود حقيقية. تغطي عقود الوضعين، الملكية قبل فك التشفير، SSRF، تصنيف 401/403/404/429/5xx/timeout، محولات البروتوكولات، SSE المقسم، التنقيح، وإيقاف البث.

## التحقق الكامل

```bash
npm run check
```

ويشمل lint وTypeScript للواجهة والـ API والاختبارات والبناء الإنتاجي.

## متطلبات النشر

- Node.js 20 أو أحدث.
- جميع المتغيرات ذات `VITE_` فقط قابلة للظهور في المتصفح.
- `SUPABASE_SERVICE_ROLE_KEY` و`ENCRYPTION_KEY` وبيانات bootstrap تبقى Server-only.
- استخدم HTTPS لمزودات API في الإنتاج.
- فعّل Email Auth في Supabase واضبط Site URL وRedirect URLs على نطاق Vercel.
- أضف متغيرات `PROVIDER_MAX_RESPONSE_BYTES` و`PROVIDER_MAX_OUTPUT_TOKENS` عند الحاجة ضمن حدود `.env.example`.
- لا تضع مفاتيح المزودات أو `SUPABASE_SERVICE_ROLE_KEY` أو `ENCRYPTION_KEY` في أي متغير يبدأ بـ `VITE_`.

### نشر Vercel

1. اربط المستودع بمشروع Vercel وحدد Node.js 20+.
2. أضف متغيرات الخادم من `.env.example` إلى **Environment Variables** (Production/Preview حسب الحاجة)، خصوصًا `SUPABASE_SERVICE_ROLE_KEY` و`ENCRYPTION_KEY` و`SUPABASE_URL` و`APP_URL`.
3. اترك `ALLOW_INSECURE_PROVIDER_URLS=false`، ثم نفّذ migration على Supabase قبل اختبار الحفظ.
4. بعد النشر اختبر `/api/health` و`/api/ready`، ثم سيناريو الجلسة المؤقتة وسيناريو الحفظ المشفّر. راقب سجلات Vercel للتشخيص المنقح فقط.

## الملفات الجديدة المهمة

- `shared/provider-registry.ts`
- `api/_lib/provider-schemas.ts`, `redaction.ts`, `provider-credentials.ts`
- `api/_lib/providers/{types,http,openai-compatible,gemini,anthropic}.ts`
- `src/lib/session-provider.ts`, `local-chat-store.ts`, `chat-api.ts`
- `supabase/migrations/20260714190000_byok_provider_protocol.sql`

## قبل النشر

راجع [PRODUCTION-CHECKLIST.md](./PRODUCTION-CHECKLIST.md) و[SECURITY.md](./SECURITY.md). لا يحتوي المشروع على كلمة مرور المالك أو مفاتيح حقيقية؛ تُضبط جميعها كمتغيرات خادمية.

## حدود معروفة بصدق

- حدّ rate limit للجلسة المؤقتة محفوظ في ذاكرة instance داخل Function؛ لذلك يظل الحد موزعًا بين instances في Vercel، ويجب دعمه بحدود Vercel Firewall/WAF عند التوسع. الوضع المحفوظ يستخدم limiter الذري في PostgreSQL.
- نجاح اختبار المزود يعتمد على استجابة API فعلية. إذا لم تدعم البوابة `/models`، يُستخدم النموذج الذي أدخله المستخدم لطلب توليد فعلي، ولا تُخمن صحة المفتاح من شكله.
- لا تزال تكاملات GitHub وMCP وAgent Loop خارج نطاق هذه النسخة؛ تكامل Telegram منفذ عبر Webhook لكن يحتاج Bot Token ومزودًا محفوظًا يضيفهما المستخدم.

## تكامل Telegram Bot الحقيقي

Telegram يعمل من Vercel Webhook حتى عند إغلاق المتصفح. لا يمكنه استخدام مفتاح جلسة مؤقتة؛ يجب اختيار مزود محفوظ ومختبر ونموذج موجود في قائمة النماذج. توكن البوت يُختبر عبر `getMe`، ثم يُشفّر بـ AES-256-GCM، ويُسجّل Webhook مع Secret عشوائي لا يُحفظ إلا كـ SHA-256.

نفّذ migration الجديدة `supabase/migrations/20260714203349_telegram_integrations.sql` للمشاريع الموجودة. جداول `telegram_integrations` و`telegram_link_codes` و`telegram_updates` و`telegram_messages` و`telegram_chat_links` مفعّل عليها RLS ولا توجد لها صلاحيات للمتصفح؛ لا تُقرأ إلا عبر Vercel Functions باستخدام Service Role.

### إعداد البوت والربط

1. افتح Telegram وابحث عن `@BotFather`، نفّذ `/newbot` واختر اسمًا وusername، ثم انسخ Bot Token إلى صفحة **التكاملات**.
2. أضف مزودًا محفوظًا في صفحة **المزودات**، اختبره فعليًا، وتأكد أن حالته «متصل» وأن النموذج ظاهر ضمن النماذج المكتشفة.
3. في صفحة **التكاملات** اختبر Bot Token، اختر المزود والنموذج، ثم اضغط «تسجيل Webhook وحفظ مشفّر».
4. تحقق من ظهور اسم البوت وBot ID وWebhook URL وPending Updates، ثم استخدم «فحص Webhook» عند الحاجة.
   ولتشخيص شامل آمن استخدم `POST /api/integrations/telegram/diagnose` مع `integrationId`؛ يعيد صلاحية التوكن، بيانات البوت العامة، حالة Webhook، صلاحية المزود، النموذج، عدد المحادثات، آخر تحديث، والتوصيات دون أي سر.
5. اضغط «توليد كود ربط»، وأرسل إلى البوت الأمر الظاهر مثل `/connect ABCD-2345` خلال عشر دقائق.
6. بعد ظهور Chat في لوحة الموقع، أرسل رسالة نصية عادية إلى البوت. تُحفظ آخر 20 رسالة فقط كسياق، ويُستدعى Adapter المزود الحقيقي ثم تُرسل الإجابة مقسمة إلى قطع Telegram لا تتجاوز 4096 حرفًا.

لا تستخدم `getUpdates` أو Polling. عند تغيير النطاق أو فقدان السر استخدم «إعادة التسجيل» لتدوير Webhook Secret؛ لا يمكن استرجاع السر القديم لأنه لا يُحفظ كنص واضح.

### مثال نتيجة `getWebhookInfo` بعد تنقيح الأسرار

```json
{
  "url": "https://your-domain.vercel.app/api/integrations/telegram/webhook",
  "pending_update_count": 0,
  "max_connections": 40,
  "last_error_message": null
}
```

لا يعرض API أو السجل Bot Token أو Webhook Secret أو مفتاح مزود الذكاء الاصطناعي.

### تدوير الأسرار والحذف الآمن

- عند فقدان Bot Token استخدم BotFather لتدويره، ثم احذف التكامل القديم وأنشئه من جديد؛ لا تحفظ التوكن في ملفات المتصفح.
- `ENCRYPTION_KEY` ثابت طوال عمر المفاتيح المشفرة. تدويره يتطلب خطة إعادة تشفير على الخادم: فك المفاتيح بالمفتاح القديم، إعادة تشفيرها بالجديد، ثم تحديث المتغير وإعادة النشر. لا تغيّره مباشرة.
- حذف التكامل يستدعي `deleteWebhook` ثم يحذف السجل والروابط والرسائل التابعة عبر Foreign Keys؛ إذا تعذر Telegram يُسجل تحذير منقح ويستمر حذف البيانات المحلية.

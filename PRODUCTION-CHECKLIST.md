# قائمة تشغيل Moataz AI

## 1. قاعدة البيانات

1. أنشئ مشروع Supabase أو استخدم مشروعك الحالي.
2. نفّذ `supabase/schema.sql` كاملًا في SQL Editor.
3. للمشروع الموجود، نفّذ أيضًا `supabase/migrations/20260714190000_byok_provider_protocol.sql` (يمكن تكراره بأمان).
4. نفّذ migration Telegram الجديدة `supabase/migrations/20260714203349_telegram_integrations.sql`.
5. نفّذ migration الاتصالات `supabase/migrations/20260715222138_external_integrations.sql`.
6. نفّذ `supabase/migrations/20260718120000_provider_manager.sql` لإضافة Health/Circuit/Retry/Logs (قابلة لإعادة التنفيذ ولا تحذف البيانات).
7. تأكد أن التنفيذ انتهى دون أخطاء.
8. لا تمنح `authenticated` أو `anon` صلاحيات مباشرة على جداول الأسرار أو جدولي `providers` و`external_integrations`؛ الإدارة تتم عبر API الخادمي فقط.

## 2. متغيرات Vercel

انسخ القيم المطلوبة من `.env.example`. أهم المتغيرات:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY` أو `VITE_SUPABASE_ANON_KEY` القديم
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — خادمي فقط
- `ENCRYPTION_KEY` — سر عشوائي ثابت بطول 32 حرفًا على الأقل
- `APP_URL` — النطاق النهائي HTTPS الذي سيستقبل Telegram Webhook
- `TELEGRAM_API_TIMEOUT_MS`
- `TELEGRAM_WEBHOOK_PROCESSING_TIMEOUT_MS`
- `TELEGRAM_MAX_CONTEXT_MESSAGES`
- `TELEGRAM_MAX_RESPONSE_CHARACTERS`
- `CRON_SECRET` — سر عشوائي طويل لفحص الصحة المجدول (مرة يوميًا على Hobby؛ يمكن زيادة التواتر على Pro).
- `PROVIDER_TIMEOUT_MS`, `PROVIDER_MAX_RESPONSE_BYTES`, `PROVIDER_MAX_OUTPUT_TOKENS`

لا تغيّر `ENCRYPTION_KEY` بعد إضافة المزودات؛ تغييره يجعل المفاتيح المخزنة سابقًا غير قابلة لفك التشفير. عند الحاجة إلى تدويره، أعد إدخال مفاتيح المزودات أو نفّذ خطة إعادة تشفير.

## 3. المالك الأول

اضبط مؤقتًا:

```env
BOOTSTRAP_OWNER_EMAIL=mtzallqmy@gmail.com
BOOTSTRAP_OWNER_PASSWORD=كلمة-مؤقتة-قوية
BOOTSTRAP_TOKEN=رمز-عشوائي-طويل-جداً
```

انشر المشروع، ثم نفّذ طلب `POST /api/setup/bootstrap` مع `X-Bootstrap-Token`. بعد النجاح:

1. احذف `BOOTSTRAP_TOKEN` و`BOOTSTRAP_OWNER_PASSWORD` من Vercel.
2. أعد النشر.
3. سجّل الدخول وغيّر كلمة المرور المؤقتة.

لا تضع كلمة مرور المالك داخل Git أو ملفات المشروع.

## 4. تحقق التشغيل

- `GET /api/health` يجب أن يعيد `status: ok`.
- `GET /api/ready` يجب أن يعيد `status: ready` و`rateLimit: ready`.
- `GET https://bsmzknhkzepaqeffrfbc.supabase.co/auth/v1/settings` مع المفتاح العام يجب أن يعيد `external.google: true` و`external.github: true` قبل اختبار زري OAuth.
- اختبر Google وGitHub من `https://moatazasaif.vercel.app/login` وتأكد أن الرجوع النهائي يبقى على نطاق Vercel وأن `/api/auth/me` يعيد ملف المستخدم.
- أنشئ مستخدمًا تجريبيًا من لوحة الإدارة وسجّل الدخول باسم المستخدم.
- أضف مفتاح مزود تملكه، نفّذ «اختبار واكتشاف»، ثم أرسل رسالة حقيقية.
- راجع أن رسالة الخطأ المعروضة هي رسالة المزود وتصنيفها، وليست نجاحًا وهميًا.
- اختبر الجلسة المؤقتة دون Supabase: المفتاح في `sessionStorage` والمحادثات في IndexedDB، ثم استخدم زر المسح وتحقق من اختفاء الاثنين.
- راجع Network response وVercel logs وتأكد من عدم وجود `apiKey` أو Authorization أو `encrypted_key`.
- أنشئ Bot من BotFather، اختبر `getMe`، سجّل Webhook، ثم نفّذ فحص Webhook من صفحة التكاملات وتحقق من معلومات البوت الفعلية.
- ولّد كود الربط، أرسل `/connect CODE` إلى البوت، ثم أرسل رسالة عادية وتحقق من وصول رد النموذج الحقيقي.
- من صفحة التكاملات اختبر Fine-grained GitHub PAT ثم احفظه واعرض قائمة المستودعات.
- إذا توفرت بيانات Meta، اختبر System User token وPhone Number ID ثم أرسل رسالة WhatsApp إلى رقم تجريبي بصيغة دولية.
- افتح `/developer/diagnostics` بحساب مالك/مدير، ثم نفّذ Test وHealth وDiscover Models وتأكد من تحديث latency/counters وCircuit.
- صدّر Logs بصيغة JSON وCSV، وتحقق من عدم وجود API keys أو Authorization أو `encrypted_key`.

## 5. حدود النسخة الحالية

- لا يوجد نظام دفع أو اشتراكات داخلية.
- GitHub مفعّل للاختبار وعرض المستودعات، وWhatsApp مفعّل للاختبار والإرسال النصي. عمليات GitHub الكتابية واستقبال WhatsApp وMCP ووضع الوكيل تبقى غير مفعّلة حتى تعريف صلاحياتها وأسرارها المطلوبة.
- الاختبارات الآلية لا تتصل بمفاتيح مزودات حقيقية؛ اختبار الاتصال الحقيقي يتم بعد إضافة مفاتيحك من لوحة المزودات.
- Vercel Functions لا تعتمد على ذاكرة محلية كطابور دائم؛ `queueSize` تشخيصي ويظل 0. للمهام الطويلة أضف Queue خارجية (مثل Vercel Queues/Upstash) قبل تفعيلها.
- على خطة Hobby فحص الصحة مجدول يوميًا فقط بسبب قيد Vercel؛ استخدم Pro أو Scheduler خارجي لفحص متكرر.

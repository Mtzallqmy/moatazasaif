# تقرير التحقق والإطلاق

## نتائج الفحوصات الآلية

تم تشغيل الأوامر التالية بعد إعادة تثبيت الاعتماديات من `package-lock.json`:

```text
npm ci --no-audit --no-fund       PASS
npm run lint                     PASS
npm run typecheck                PASS
npm run typecheck:api            PASS
npm run test                     PASS — 29 ملفًا / 116 اختبارًا
npm run build                    PASS
npm audit --omit=dev             PASS — 0 ثغرات
```

الاختبارات تستخدم Mock لـ `fetch` وSupabase وIndexedDB، ولا تستخدم مفاتيح حقيقية.
وتشمل عميل Telegram (`getMe`, `setWebhook`, `getWebhookInfo`, `deleteWebhook`,
`sendChatAction`, `sendMessage`, `setMyCommands`)، أخطاء 429 وإعادة المحاولة،
التنقيح، Webhook Secret، Deduplication، Link Code، Allowlist، والسياق مع Provider Runtime.
وتشمل أيضًا سياسات Provider Manager النقية: ترتيب الأولوية، Health Status، Circuit
Breaker، Retry مع Exponential Backoff، Failover قبل أول chunk، واكتشاف النماذج.
وتغطي هذه الدفعة أيضًا حدود مهلة كل مزود، وعدم إعادة محاولة الطلب الملغى، وتفضيل
المزود السليم على مزود Offline حتى لو كانت أولوية الأخير الرقمية أعلى، ومنع Failover
بعد إرسال أول جزء من محتوى البث حتى لا تختلط إجابتان في المحادثة نفسها.
كما تغطي ثبات نطاق OAuth الذي بدأ تدفق PKCE، والتنظيف المستقل لملف verifier،
وتحويل أسماء Kimi القديمة على Zyloo إلى المعرّف القانوني دون التأثير على OpenRouter.

## رحلة المستخدم

| السيناريو | النتيجة | الدليل |
|---|---|---|
| Guest BYOK test | PASS آليًا | `provider-test-handler.test.ts` |
| Guest streaming chat | PASS آليًا | `chat-handler.test.ts` و`provider-adapters.test.ts` |
| Session key removed after tab close | PASS تصميميًا/اختبار تخزين | `session-local.test.ts`؛ سلوك الإغلاق يعتمد على المتصفح |
| Saved encrypted provider | PASS آليًا | `provider-byok.test.ts` + AES server-only |
| Provider model discovery | PASS آليًا | `provider-runtime.test.ts` |
| Telegram token getMe | PASS Mock فقط | `telegram.test.ts` |
| Telegram setWebhook | PASS Mock فقط | `telegram.test.ts` |
| Telegram getWebhookInfo | PASS Mock فقط | `telegram.test.ts` |
| Telegram link code | PASS آليًا | `processing.test.ts` ومسارات الخدمة |
| Telegram incoming message | PASS Mock لـ Supabase | `processing.test.ts` |
| AI provider invocation | PASS Mock | `processing.test.ts` |
| Telegram outgoing response | PASS Mock | `processing.test.ts` |
| Duplicate update ignored | PASS آليًا | `webhook.test.ts` |
| Invalid webhook secret rejected | PASS آليًا | `webhook.test.ts` |
| Unlinked chat rejected | PASS في مسار الخدمة | `service.ts` allowlist |
| Provider timeout handled | PASS Adapter/runtime | اختبارات Provider |
| Secrets absent from responses and logs | PASS | اختبارات redaction وTelegram |
| Production build successful | PASS | `npm run build` |

## تحقق Vercel الإنتاجي

| الفحص | النتيجة | الدليل |
|---|---|---|
| Deployment from `main` | PASS | `9143e52ebb2554925a4bb00d1a2e768eacf3f399` → READY |
| `GET /api/health` | PASS | HTTP 200 على `https://moatazasaif.vercel.app` |
| `GET /api/ready` | PASS | HTTP 200 على `https://moatazasaif.vercel.app` |
| Diagnostics without JWT | PASS | HTTP 401 (حماية متوقعة) |
| Cron health without `CRON_SECRET` | PASS | HTTP 401 (حماية متوقعة) |

## ما لم يُختبر خارجيًا

لم يتم الادعاء باختبار Telegram الحقيقي أو Vercel Webhook الحقيقي: يلزم Bot Token فعلي،
نطاق Vercel منشور عبر HTTPS، وقاعدة Supabase التي تحتوي Migration. كما لم تُطبق Migration
على المشروع البعيد في هذه الجلسة بسبب عدم توفر صلاحية الاتصال به. النطاق
`www.moatazalalqami.online` يعيد 404 لمسارات `/api` لأنه تطبيق Sites/Vinext منفصل؛
لم يُحدّث في هذه الجلسة لأن موصل Sites رفض طلب الوصول. النشر الذي تم التحقق منه هو
`https://moatazasaif.vercel.app`.

## المراجعة الأمنية

- لا توجد قيم أسرار حقيقية في المصدر أو `.env.example`.
- مفاتيح الجلسة لا تُحفظ إلا في `sessionStorage`؛ المحادثات المحلية في IndexedDB دون المفتاح.
- Bot Token وProvider API Key لا يظهران في استجابات API، ولا يُسجلان في السجل.
- الأعمدة المشفرة Server-only، وRLS والمنح تمنع وصول `anon` و`authenticated` المباشر.
- كل استعلام تكامل يقيّد `user_id` أو `integration_id` بعد التحقق من الملكية.
- Session rate limit يستخدم limiter ذريًا موزعًا في PostgreSQL عندما تكون بيئة Supabase
  مضبوطة في الإنتاج، ولا يُرسل سوى بصمات HMAC. وضع الجلسة بلا Supabase يحتفظ بـ fallback
  داخل Function، بينما المسارات المحفوظة وTelegram تستخدم PostgreSQL دائمًا.

## Endpoints النهائية

- `POST /api/providers/test`, `GET/POST/PATCH/DELETE /api/providers`
- `POST /api/chat`
- `GET/POST/PATCH/DELETE /api/integrations/telegram`
- `POST /api/integrations/telegram/test`
- `POST /api/integrations/telegram/diagnose`
- `POST /api/integrations/telegram/link-code`
- `POST /api/integrations/telegram/webhook` (بدون JWT؛ عبر Secret Header)
- `GET /api/health`, `GET /api/ready`
- `GET /api/providers/diagnostics` (JWT؛ JSON أو `?logs=true&format=csv`)
- `POST /api/providers/diagnostics` (JWT؛ `test|health|discover|reload|reset-circuit`)
- `GET /api/providers/logs` (مرادف للتشخيص مع تصدير JSON/CSV)
- `GET /api/providers/health` (Cron؛ يتطلب `Authorization: Bearer $CRON_SECRET`)

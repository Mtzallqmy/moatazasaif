# إعداد Supabase لمشروع Moataz AI

1. افتح **SQL Editor** ونفّذ `schema.sql` كاملًا.
2. إذا كان المشروع قائمًا على مخطط أقدم، نفّذ `migrations/20260714190000_byok_provider_protocol.sql`؛ العملية قابلة لإعادة التنفيذ وتضيف دعم `protocol` و`dahl`.
3. نفّذ migration `migrations/20260714203349_telegram_integrations.sql` لتكامل Telegram؛ جداولها Server-only ولا تمنح المتصفح أي صلاحيات.
4. نفّذ migration `migrations/20260718120000_provider_manager.sql` لإضافة أولوية المزود، مهلة وإعادة محاولة، حالة الصحة، Circuit Breaker، إحصاءات التوفر وسجل التشخيص. migration idempotent ولا تحذف بيانات المفاتيح المشفّرة.
5. نفّذ migration `migrations/20260718212100_chat_files_and_projects.sql` لإنشاء bucket خاص للمرفقات وجداول المشاريع والملفات بسياسات ملكية وبدون منح وصول مباشر للمتصفح.
6. أضف متغيرات البيئة الموجودة في `.env.example` إلى منصة النشر. استخدم `APP_URL=https://moatazasaif.vercel.app` حتى يُربط الدومين المخصص فعليًا بنفس المشروع، ثم غيّره إلى `https://moatazalalqami.online`.
7. من Dashboard → Authentication → URL Configuration اضبط Site URL على `https://moatazalalqami.online` وأضف Redirect URLs للنطاق الأساسي و`www` و`https://moatazasaif.vercel.app/login`. راجع قالب Magic Link وتأكد أنه يستخدم `{{ .ConfirmationURL }}` أو `{{ .RedirectTo }}`، وليس localhost ثابتًا.
8. لتفعيل الدخول الاجتماعي: من Authentication → Providers فعّل Google وGitHub، وضع بيانات OAuth الخاصة بهما. عنوان callback لدى المزودين هو `https://<project-ref>.supabase.co/auth/v1/callback`، بينما يحافظ التطبيق على مضيف الموقع الذي بدأ التدفق حتى اكتمال PKCE.
9. للتهيئة الرسمية لأول مالك:
   - اضبط `BOOTSTRAP_TOKEN` بقيمة عشوائية طويلة.
   - اضبط `BOOTSTRAP_OWNER_EMAIL=mtzallqmy@gmail.com`.
   - اضبط `BOOTSTRAP_OWNER_PASSWORD` مؤقتًا.
   - انشر المشروع، ثم نفّذ طلب POST إلى `/api/setup/bootstrap` مع الهيدر `X-Bootstrap-Token`.
   - بعد النجاح احذف `BOOTSTRAP_TOKEN` و`BOOTSTRAP_OWNER_PASSWORD` من Vercel وأعد النشر.
10. إذا كان المستخدم موجودًا مسبقًا في Supabase Auth، يمكن تشغيل `execute-bootstrap.sql` لترقيته فقط. هذا الملف لا ينشئ مستخدمًا ولا يغيّر كلمة المرور.

لا تستخدم `raw_user_meta_data` للصلاحيات. المصدر الرسمي داخل التطبيق هو `public.profiles.role`، مع نسخة مساعدة في `raw_app_meta_data.app_role` تُحدّث فقط من الخادم.

# إعداد Supabase لمشروع Moataz AI

1. افتح **SQL Editor** ونفّذ `schema.sql` كاملًا.
2. إذا كان المشروع قائمًا على مخطط أقدم، نفّذ `migrations/20260714190000_byok_provider_protocol.sql`؛ العملية قابلة لإعادة التنفيذ وتضيف دعم `protocol` و`dahl`.
3. نفّذ migration `migrations/20260714203349_telegram_integrations.sql` لتكامل Telegram؛ جداولها Server-only ولا تمنح المتصفح أي صلاحيات.
4. أضف متغيرات البيئة الموجودة في `.env.example` إلى Vercel، خصوصًا `APP_URL` وقيم Telegram الزمنية.
5. للتهيئة الرسمية لأول مالك:
   - اضبط `BOOTSTRAP_TOKEN` بقيمة عشوائية طويلة.
   - اضبط `BOOTSTRAP_OWNER_EMAIL=mtzallqmy@gmail.com`.
   - اضبط `BOOTSTRAP_OWNER_PASSWORD` مؤقتًا.
   - انشر المشروع، ثم نفّذ طلب POST إلى `/api/setup/bootstrap` مع الهيدر `X-Bootstrap-Token`.
   - بعد النجاح احذف `BOOTSTRAP_TOKEN` و`BOOTSTRAP_OWNER_PASSWORD` من Vercel وأعد النشر.
6. إذا كان المستخدم موجودًا مسبقًا في Supabase Auth، يمكن تشغيل `execute-bootstrap.sql` لترقيته فقط. هذا الملف لا ينشئ مستخدمًا ولا يغيّر كلمة المرور.

لا تستخدم `raw_user_meta_data` للصلاحيات. المصدر الرسمي داخل التطبيق هو `public.profiles.role`، مع نسخة مساعدة في `raw_app_meta_data.app_role` تُحدّث فقط من الخادم.

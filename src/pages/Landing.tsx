import { Link } from 'react-router-dom'
import { ArrowLeft, Bot, BookOpen, KeyRound, MessageCircle, ShieldCheck, Sparkles, Users } from 'lucide-react'
import { motion } from 'framer-motion'
import PublicPreferencesButton from '../components/PublicPreferencesButton'
import AnnouncementBar from '../components/AnnouncementBar'
import { usePreferences } from '../contexts/PreferencesContext'
import { useSiteSettings } from '../contexts/SiteSettingsContext'

export default function Landing() {
  const { preferences, t, tr } = usePreferences()
  const { settings, navigation } = useSiteSettings()
  const brandName = tr(settings.siteNameAr, settings.siteNameEn)
  const tagline = tr(settings.taglineAr, settings.taglineEn)
  const headerLinks = navigation.filter((item) => item.location === 'header' && item.isActive)
  const footerLinks = navigation.filter((item) => item.location === 'footer' && item.isActive)
  const features = [
    { icon: MessageCircle, title: t('landing.featureChat'), desc: t('landing.featureChatDesc') },
    { icon: Bot, title: t('landing.featureProviders'), desc: t('landing.featureProvidersDesc') },
    { icon: Users, title: t('landing.featureUsers'), desc: t('landing.featureUsersDesc') },
    { icon: ShieldCheck, title: t('landing.featureSecurity'), desc: t('landing.featureSecurityDesc') },
  ]
  const providers = ['Gemini', 'OpenAI', 'Anthropic', 'NVIDIA NIM', 'Groq', 'DeepSeek', 'Mistral', 'OpenAI-compatible']

  return <div className="app-canvas min-h-screen overflow-hidden">
    <AnnouncementBar />
    {settings.maintenanceMode && <div className="maintenance-banner" role="status">{tr(settings.maintenanceMessageAr || 'نجري تحسينات مجدولة مع بقاء الخدمات الأساسية متاحة.', settings.maintenanceMessageEn || 'Scheduled improvements are underway while core services remain available.')}</div>}
    <PublicPreferencesButton />
    <nav className="sticky top-0 z-50 bg-white/80 dark:bg-dark-950/80 backdrop-blur-xl border-b border-dark-200 dark:border-white/10">
      <div className="max-w-7xl mx-auto px-5 pe-20 sm:pe-24 h-20 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3"><div className="brand-gradient w-10 h-10 rounded-2xl text-white grid place-items-center font-bold text-xl">{brandName.charAt(0)}</div><div><div className="font-semibold text-lg leading-tight">{brandName}</div><div className="text-[10px] text-dark-500">AI Workspace</div></div></Link>
        <div className="flex items-center gap-2 sm:gap-4 text-sm">{headerLinks.slice(0, 3).map((item) => item.isExternal ? <a key={item.id} href={item.href} target="_blank" rel="noopener noreferrer" className="text-dark-500 hover:text-dark-900 dark:hover:text-white hidden lg:block">{tr(item.labelAr, item.labelEn)}</a> : <Link key={item.id} to={item.href} className="text-dark-500 hover:text-dark-900 dark:hover:text-white hidden lg:block">{tr(item.labelAr, item.labelEn)}</Link>)}{settings.blogEnabled && <Link to="/blog" className="text-dark-500 hover:text-dark-900 dark:hover:text-white hidden md:block">{tr('المقالات', 'Articles')}</Link>}<Link to="/privacy" className="text-dark-500 hover:text-dark-900 dark:hover:text-white hidden lg:block">{t('landing.privacy')}</Link><Link to="/login" className="btn btn-secondary hidden sm:inline-flex">{t('landing.account')}</Link>{settings.allowRegistration && <Link to="/register" className="btn btn-primary">{t('landing.register')}</Link>}</div>
      </div>
    </nav>

    <main>
      <section className="relative px-5 pt-20 sm:pt-28 pb-20">
        <div className="landing-glow landing-glow-one" /><div className="landing-glow landing-glow-two" />
        <div className="max-w-6xl mx-auto relative z-10 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary-500/10 border border-primary-500/20 text-primary-700 dark:text-primary-300 text-sm mb-7"><Sparkles size={15} />{t('landing.badge')}</div>
          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-semibold tracking-[-0.045em] leading-[1.08] max-w-5xl mx-auto">{t('landing.title')}</h1>
          <p className="max-w-3xl mx-auto text-lg sm:text-xl text-dark-500 mt-7 leading-8">{tagline}</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center mt-10"><Link to="/chat" className="btn btn-primary px-8 py-4 text-base group">{t('landing.try')} <ArrowLeft className="group-hover:-translate-x-1 transition-transform" size={18} /></Link>{settings.blogEnabled && <Link to="/blog" className="btn btn-secondary px-8 py-4 text-base"><BookOpen size={18} />{tr('استكشف المقالات', 'Explore articles')}</Link>}</div>
          <div className="mt-7 text-xs text-dark-500 flex flex-wrap justify-center gap-x-5 gap-y-2"><span>✓ {tr('جلسة محلية بمفتاحك', 'Local BYOK session')}</span><span>✓ {tr('مفاتيح مشفرة للحساب', 'Encrypted account keys')}</span><span>✓ {tr('عربي وإنجليزي', 'Arabic & English')}</span></div>
        </div>
      </section>

      <section className="border-y border-dark-200 dark:border-white/10 bg-white/60 dark:bg-dark-900/40 py-8"><div className="max-w-6xl mx-auto px-5 flex flex-wrap items-center justify-center gap-3">{providers.map((provider) => <span key={provider} className="px-4 py-2 rounded-full border border-dark-200 dark:border-white/10 bg-white dark:bg-white/5 text-sm text-dark-600 dark:text-dark-300">{provider}</span>)}</div></section>

      <section className="max-w-6xl mx-auto px-5 py-20 sm:py-28"><div className="max-w-2xl mb-12"><div className="text-primary-600 dark:text-primary-400 font-semibold text-sm tracking-wide mb-3">{t('landing.featuresEyebrow')}</div><h2 className="text-4xl sm:text-5xl font-semibold tracking-tight">{t('landing.featuresTitle')}</h2></div><div className="grid md:grid-cols-2 gap-5">{features.map((feature) => { const Icon = feature.icon; return <motion.article key={feature.title} whileHover={preferences.reduceMotion ? undefined : { y: -4 }} className="card p-7 sm:p-8"><div className="section-icon mb-6"><Icon size={21} /></div><h3 className="text-xl sm:text-2xl font-semibold">{feature.title}</h3><p className="text-dark-500 leading-7 mt-3">{feature.desc}</p></motion.article> })}</div></section>

      <section className="max-w-6xl mx-auto px-5 pb-24"><div className="rounded-[2rem] bg-dark-950 text-white p-8 sm:p-12 lg:p-16 relative overflow-hidden"><div className="landing-glow landing-glow-two" /><div className="relative z-10 grid lg:grid-cols-[1fr_auto] items-center gap-8"><div><div className="flex items-center gap-2 text-primary-300 text-sm font-medium"><KeyRound size={17} />{tr('ابدأ بالطريقة المناسبة لك', 'Start your way')}</div><h2 className="text-3xl sm:text-5xl font-semibold tracking-tight mt-4">{tr('مفتاحك الخاص أو مزود المنصة.', 'Your own key or the platform provider.')}</h2><p className="text-white/65 max-w-2xl mt-4 leading-7">{tr('يمكنك تجربة مفتاحك محليًا دون حفظه، أو حفظه مشفرًا في حسابك، أو استخدام المزود الافتراضي ضمن حدود الاستخدام التي يحددها المالك.', 'Try your key locally without saving it, encrypt it in your account, or use the default platform provider within owner-defined usage limits.')}</p></div><Link to={settings.allowRegistration ? '/register' : '/login'} className="btn btn-primary px-8 py-4 text-base shrink-0">{settings.allowRegistration ? t('landing.register') : t('landing.account')}</Link></div></div></section>
    </main>

    <footer className="border-t border-dark-200 dark:border-white/10 py-10"><div className="max-w-6xl mx-auto px-5 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-dark-500"><div>© {new Date().getFullYear()} {tr(settings.footerTextAr, settings.footerTextEn)}</div><div className="flex flex-wrap justify-center gap-5">{footerLinks.map((item) => item.isExternal ? <a key={item.id} href={item.href} target="_blank" rel="noopener noreferrer" className="hover:text-primary-500">{tr(item.labelAr, item.labelEn)}</a> : <Link key={item.id} to={item.href} className="hover:text-primary-500">{tr(item.labelAr, item.labelEn)}</Link>)}{settings.blogEnabled && <Link to="/blog" className="hover:text-primary-500">{tr('المقالات', 'Articles')}</Link>}<Link to="/privacy" className="hover:text-primary-500">{t('landing.privacy')}</Link><Link to="/terms" className="hover:text-primary-500">{t('landing.terms')}</Link></div></div></footer>
  </div>
}

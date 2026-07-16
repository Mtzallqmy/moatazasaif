import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, ArrowLeft } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { toast } from 'sonner'
import OAuthButtons from '../components/OAuthButtons'
import PublicPreferencesButton from '../components/PublicPreferencesButton'
import { usePreferences } from '../contexts/PreferencesContext'
import { useSiteSettings } from '../contexts/SiteSettingsContext'

export default function Register() {
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const { register } = useAuth()
  const { t, tr } = usePreferences()
  const { settings: siteSettings } = useSiteSettings()
  const navigate = useNavigate()

  if (!siteSettings.allowRegistration) return <div className="app-canvas min-h-screen grid place-items-center p-6"><div className="card p-8 max-w-md text-center"><h1 className="text-2xl font-semibold">{tr('التسجيل الجديد متوقف مؤقتًا', 'New registration is temporarily paused')}</h1><p className="text-dark-500 mt-3">{tr('يمكن للحسابات الحالية متابعة تسجيل الدخول بصورة طبيعية.', 'Existing accounts can continue to sign in normally.')}</p><Link to="/login" className="btn btn-primary mt-6">{t('auth.login')}</Link></div></div>

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!name || !email || !password) { toast.error(t('auth.requiredFields')); return }
    if (password.length < 8) { toast.error(t('auth.passwordTooShort')); return }
    setIsLoading(true)
    const success = await register(name, email, password, username || undefined)
    setIsLoading(false)
    if (success) navigate('/chat')
  }

  return (
    <div className="app-canvas min-h-screen flex items-center justify-center p-6">
      <PublicPreferencesButton />
      <div className="w-full max-w-md">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-dark-400 hover:text-white mb-8 group">
          <ArrowLeft size={16} className="group-hover:-translate-x-0.5 transition" /> {t('common.backHome')}
        </Link>
        <div className="card p-8 border-dark-700">
          <div className="flex justify-center mb-6"><div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary-600 to-accent-600 flex items-center justify-center"><span className="text-white text-2xl font-bold">M</span></div></div>
          <h1 className="text-3xl font-semibold tracking-tight text-center mb-2">{t('auth.registerTitle')}</h1>
          <p className="text-center text-dark-500 mb-8">{t('auth.registerSubtitle')}</p>
          <OAuthButtons />
          <div className="relative my-6"><div className="absolute inset-0 flex items-center"><div className="w-full border-t border-dark-200 dark:border-dark-700" /></div><div className="relative flex justify-center"><span className="bg-white dark:bg-dark-800 px-3 text-xs text-dark-500">{t('auth.orEmail')}</span></div></div>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div><label className="block text-sm font-medium mb-2 text-dark-600 dark:text-dark-300">{t('auth.fullName')}</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} required /></div>
            <div><label className="block text-sm font-medium mb-2 text-dark-600 dark:text-dark-300">{t('auth.optionalUsername')}</label><input className="input" dir="ltr" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="moataz" /></div>
            <div><label className="block text-sm font-medium mb-2 text-dark-600 dark:text-dark-300">{t('auth.email')}</label><input type="email" className="input" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
            <div>
              <label className="block text-sm font-medium mb-2 text-dark-600 dark:text-dark-300">{t('auth.password')}</label>
              <div className="relative"><input type={showPassword ? 'text' : 'password'} className="input pe-12" placeholder={t('settings.passwordLength')} value={password} onChange={(e) => setPassword(e.target.value)} required /><button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute end-4 top-1/2 -translate-y-1/2 text-dark-400" aria-label={showPassword ? tr('إخفاء كلمة المرور', 'Hide password') : tr('إظهار كلمة المرور', 'Show password')}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
            </div>
            <button type="submit" disabled={isLoading} className="btn btn-primary w-full py-3.5">{isLoading ? t('auth.creating') : t('auth.register')}</button>
          </form>
          <div className="mt-6 text-center text-sm">{t('auth.hasAccount')} <Link to="/login" className="text-primary-500 hover:underline">{t('auth.login')}</Link></div>
        </div>
      </div>
    </div>
  )
}

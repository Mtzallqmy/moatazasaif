import { useEffect, useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { Eye, EyeOff, ArrowLeft, Mail } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { toast } from 'sonner'
import OAuthButtons from '../components/OAuthButtons'
import { clearAuthCallbackFailure, readAuthCallbackFailure } from '../lib/auth-callback-error'
import { usePreferences } from '../contexts/PreferencesContext'
import PublicPreferencesButton from '../components/PublicPreferencesButton'
import { homeForUser } from '../lib/access'

export default function Login() {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [passwordless, setPasswordless] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  
  const { user, login, requestMagicLink } = useAuth()
  const { t, tr } = usePreferences()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as any)?.from?.pathname as string | undefined

  useEffect(() => {
    const failure = readAuthCallbackFailure(window.location.search, window.location.hash)
    if (!failure) return
    toast.error(failure.message, { duration: 12_000 })
    clearAuthCallbackFailure()
  }, [])

  useEffect(() => {
    if (user) navigate(from || homeForUser(user), { replace: true })
  }, [from, navigate, user])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!identifier || (!passwordless && !password)) {
      toast.error(passwordless ? t('auth.requiredEmail') : t('auth.requiredCredentials'))
      return
    }
    
    setIsLoading(true)
    const success = passwordless ? await requestMagicLink(identifier) : await login(identifier, password)
    setIsLoading(false)
    
    // Password login updates `user`, and the effect above selects a role-safe
    // destination. Magic-link requests intentionally stay on this page.
    void success
  }

  return (
    <div className="app-canvas min-h-screen flex items-center justify-center p-6">
      <PublicPreferencesButton />
      <div className="w-full max-w-md">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-dark-400 hover:text-white mb-8 group">
          <ArrowLeft size={16} className="group-hover:-translate-x-0.5 transition" /> {t('common.backHome')}
        </Link>

        <div className="card p-8 border-dark-700">
          <div className="flex justify-center mb-6">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary-600 to-accent-600 flex items-center justify-center">
              <span className="text-white text-2xl font-bold">M</span>
            </div>
          </div>

          <h1 className="text-3xl font-semibold tracking-tight text-center mb-2">{t('auth.welcome')}</h1>
          <p className="text-center text-dark-500 mb-8">{t('auth.loginSubtitle')}</p>

          <OAuthButtons />

          <div className="relative my-6"><div className="absolute inset-0 flex items-center"><div className="w-full border-t border-dark-200 dark:border-dark-700" /></div><div className="relative flex justify-center"><span className="bg-white dark:bg-dark-800 px-3 text-xs text-dark-500">{t('auth.orEmail')}</span></div></div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium mb-2 text-dark-600 dark:text-dark-300">{t('auth.email')}</label>
              <input 
                className="input" 
                placeholder="you@example.com" 
                type="email"
                value={identifier} 
                onChange={e => setIdentifier(e.target.value)}
                required 
              />
            </div>

            {!passwordless && <div>
              <label className="block text-sm font-medium mb-2 text-dark-600 dark:text-dark-300">{t('auth.password')}</label>
              <div className="relative">
                <input 
                  type={showPassword ? 'text' : 'password'} 
                  className="input pe-12"
                  placeholder="••••••••" 
                  value={password} 
                  onChange={e => setPassword(e.target.value)}
                  required 
                />
                <button 
                  type="button" 
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute end-4 top-1/2 -translate-y-1/2 text-dark-400 hover:text-dark-700 dark:hover:text-dark-200"
                  aria-label={showPassword ? tr('إخفاء كلمة المرور', 'Hide password') : tr('إظهار كلمة المرور', 'Show password')}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>}

            <button 
              type="submit" 
              disabled={isLoading}
              className="btn btn-primary w-full py-3.5 text-base mt-2"
            >
              {isLoading ? t('auth.sending') : passwordless ? <><Mail size={17} /> {t('auth.sendLink')}</> : t('auth.login')}
            </button>
          </form>

          <button type="button" className="w-full text-sm text-primary-400 hover:underline mt-5" onClick={() => setPasswordless((value) => !value)}>
            {passwordless ? t('auth.usePassword') : t('auth.useMagicLink')}
          </button>

          <div className="mt-6 text-center text-sm">
            {t('auth.noAccount')}{' '}
            <Link to="/register" className="text-primary-500 hover:underline font-medium">{t('auth.createAccount')}</Link>
          </div>

        </div>

        <p className="text-center text-[10px] text-dark-500 mt-6">{t('common.brand')} — AI Workspace</p>
      </div>
    </div>
  )
}

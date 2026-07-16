import { Chrome, Github, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useAuth, type OAuthProvider } from '../contexts/AuthContext'
import { usePreferences } from '../contexts/PreferencesContext'

export default function OAuthButtons() {
  const { signInWithOAuth } = useAuth()
  const { t } = usePreferences()
  const [loading, setLoading] = useState<OAuthProvider | null>(null)

  const start = async (provider: OAuthProvider) => {
    setLoading(provider)
    try {
      await signInWithOAuth(provider)
    } finally {
      setLoading(null)
    }
  }

  return <div className="space-y-3">
    <button type="button" className="btn btn-secondary w-full py-3.5" disabled={loading !== null} onClick={() => void start('google')}>
      {loading === 'google' ? <Loader2 size={18} className="animate-spin" /> : <Chrome size={18} />}
      {t('auth.continueGoogle')}
    </button>
    <button type="button" className="btn btn-secondary w-full py-3.5" disabled={loading !== null} onClick={() => void start('github')}>
      {loading === 'github' ? <Loader2 size={18} className="animate-spin" /> : <Github size={18} />}
      {t('auth.continueGithub')}
    </button>
  </div>
}

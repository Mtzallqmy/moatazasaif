import { useEffect, useState } from 'react'
import { KeyRound, LogOut, Save, ShieldCheck, SlidersHorizontal, UserRound } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { usePreferences } from '../contexts/PreferencesContext'
import AppearanceControls from '../components/AppearanceControls'

export default function Settings() {
  const { user, updateUser, changePassword, logout } = useAuth()
  const { preferences, t, tr } = usePreferences()
  const [name, setName] = useState(user?.name || '')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPreferences, setSavingPreferences] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)

  useEffect(() => setName(user?.name || ''), [user?.name])

  const saveProfile = async () => {
    setSavingProfile(true)
    await updateUser({ name })
    setSavingProfile(false)
  }

  const savePreferences = async () => {
    setSavingPreferences(true)
    await updateUser({ preferences })
    setSavingPreferences(false)
  }

  const submitPassword = async (event: React.FormEvent) => {
    event.preventDefault()
    if (password.length < 8 || password !== confirmPassword) return
    setSavingPassword(true)
    const success = await changePassword(password)
    setSavingPassword(false)
    if (success) { setPassword(''); setConfirmPassword('') }
  }

  const roleLabels = {
    owner: tr('مالك', 'Owner'), admin: tr('مدير نظام', 'Administrator'), manager: tr('مدير تشغيل', 'Manager'), editor: tr('محرر', 'Editor'), user: tr('مستخدم', 'User'),
  }

  return <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
    <div className="mb-8">
      <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">{t('settings.title')}</h1>
      <p className="text-dark-500 mt-2">{t('settings.subtitle')}</p>
    </div>

    {user?.forcePasswordChange && <div className="card p-5 mb-6 border-amber-500/40 bg-amber-500/10"><div className="flex gap-3"><ShieldCheck className="text-amber-500 shrink-0" /><div><div className="font-semibold">{t('settings.temporaryPassword')}</div><p className="text-sm text-dark-500 mt-1">{t('settings.temporaryPasswordHint')}</p></div></div></div>}

    <div className="space-y-6">
      <section className="card p-5 sm:p-7" aria-labelledby="profile-heading">
        <div className="flex items-center gap-3 mb-6"><div className="section-icon"><UserRound size={19} /></div><h2 id="profile-heading" className="font-semibold text-lg">{t('settings.profile')}</h2></div>
        <div className="space-y-5">
          <div><label htmlFor="profile-name" className="text-sm text-dark-500 block mb-2">{t('settings.name')}</label><div className="flex flex-col sm:flex-row gap-2"><input id="profile-name" className="input" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} /><button type="button" onClick={() => void saveProfile()} disabled={savingProfile || !name.trim()} className="btn btn-primary sm:w-auto"><Save size={16} /> {savingProfile ? t('common.saving') : t('common.save')}</button></div></div>
          <dl className="grid sm:grid-cols-3 gap-4 rounded-2xl bg-dark-50 dark:bg-dark-900/60 p-4">
            <div><dt className="text-xs text-dark-500">{t('settings.username')}</dt><dd className="font-medium mt-1" dir="ltr">{user?.username || t('common.notSet')}</dd></div>
            <div><dt className="text-xs text-dark-500">{t('settings.email')}</dt><dd className="font-medium mt-1 truncate" dir="ltr">{user?.email || t('common.notAvailable')}</dd></div>
            <div><dt className="text-xs text-dark-500">{t('settings.role')}</dt><dd className="font-medium mt-1">{user ? roleLabels[user.role] : ''}</dd></div>
          </dl>
        </div>
      </section>

      <section className="card p-5 sm:p-7" aria-labelledby="preferences-heading">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
          <div className="flex gap-3"><div className="section-icon"><SlidersHorizontal size={19} /></div><div><h2 id="preferences-heading" className="font-semibold text-lg">{t('settings.preferences')}</h2><p className="text-sm text-dark-500 mt-1">{t('settings.preferencesHint')}</p></div></div>
          <button type="button" onClick={() => void savePreferences()} disabled={savingPreferences} className="btn btn-primary shrink-0"><Save size={16} /> {savingPreferences ? t('common.saving') : t('common.save')}</button>
        </div>
        <AppearanceControls />
      </section>

      <form onSubmit={submitPassword} className="card p-5 sm:p-7">
        <div className="flex items-center gap-3 mb-6"><div className="section-icon"><KeyRound size={19} /></div><h2 className="font-semibold text-lg">{t('settings.password')}</h2></div>
        <div className="grid sm:grid-cols-2 gap-4">
          <label><span className="sr-only">{t('settings.newPassword')}</span><input type="password" autoComplete="new-password" className="input" placeholder={t('settings.newPassword')} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <label><span className="sr-only">{t('settings.confirmPassword')}</span><input type="password" autoComplete="new-password" className="input" placeholder={t('settings.confirmPassword')} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
        </div>
        {password && password.length < 8 && <p className="text-xs text-red-500 mt-2">{t('settings.passwordLength')}</p>}
        {confirmPassword && password !== confirmPassword && <p className="text-xs text-red-500 mt-2">{t('settings.passwordMismatch')}</p>}
        <button disabled={savingPassword || password.length < 8 || password !== confirmPassword} className="btn btn-primary mt-4">{savingPassword ? t('common.saving') : t('settings.password')}</button>
      </form>

      <section className="card p-5 sm:p-7 border-red-500/20"><div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4"><div><h2 className="font-semibold text-red-500">{t('nav.logout')}</h2><p className="text-sm text-dark-500 mt-1">{t('settings.logoutHint')}</p></div><button type="button" onClick={() => void logout()} className="btn btn-danger"><LogOut size={16} /> {t('nav.logout')}</button></div></section>
    </div>
  </div>
}

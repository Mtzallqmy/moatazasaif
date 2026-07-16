import { lazy, Suspense, useEffect, useState } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { usePreferences } from './contexts/PreferencesContext'
import Sidebar from './components/Sidebar'
import Topbar from './components/Topbar'
import AppErrorBoundary from './components/AppErrorBoundary'
import AnnouncementBar from './components/AnnouncementBar'
import type { AppRole } from './types'
import { Toaster } from 'sonner'
import { CONTENT_ROLES, INTEGRATION_ROLES, MANAGEMENT_ROLES } from './lib/access'

const Landing = lazy(() => import('./pages/Landing'))
const Login = lazy(() => import('./pages/Login'))
const Register = lazy(() => import('./pages/Register'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Chat = lazy(() => import('./pages/Chat'))
const Providers = lazy(() => import('./pages/Providers'))
const Integrations = lazy(() => import('./pages/Integrations'))
const Settings = lazy(() => import('./pages/Settings'))
const AdminUsers = lazy(() => import('./pages/AdminUsers'))
const Privacy = lazy(() => import('./pages/Privacy'))
const Terms = lazy(() => import('./pages/Terms'))
const NotFound = lazy(() => import('./pages/NotFound'))
const Blog = lazy(() => import('./pages/Blog'))
const BlogArticle = lazy(() => import('./pages/BlogArticle'))
const ContentManager = lazy(() => import('./pages/ContentManager'))

function PageFallback() {
  const { t } = usePreferences()
  return <div className="app-canvas min-h-screen flex items-center justify-center"><div className="flex flex-col items-center gap-4"><div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" /><p className="text-dark-500 text-sm">{t('common.loadingPage')}</p></div></div>
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()
  const { t } = usePreferences()
  if (isLoading) return <div className="app-canvas min-h-screen flex items-center justify-center"><div className="flex flex-col items-center gap-4"><div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" /><p className="text-dark-500 text-sm">{t('common.loading')}</p></div></div>
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function RoleRoute({ roles, children }: { roles: AppRole[]; children: React.ReactNode }) {
  const { user } = useAuth()
  if (!user || !roles.includes(user.role)) return <Navigate to="/chat" replace />
  return <>{children}</>
}

function AppLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const { user, logout } = useAuth()
  const { language, preferences } = usePreferences()
  const location = useLocation()
  useEffect(() => { if (window.innerWidth < 768) setSidebarOpen(false) }, [location.pathname])
  if (!user) return <>{children}</>

  const closedClass = language === 'ar' ? 'translate-x-full' : '-translate-x-full'
  return <div className="app-canvas flex flex-col h-screen overflow-hidden"><AnnouncementBar />
    <div className="flex flex-1 min-h-0 overflow-hidden">
    <div className={`fixed md:static inset-y-0 start-0 z-50 w-72 transform transition-transform duration-300 md:translate-x-0 ${sidebarOpen ? 'translate-x-0' : `${closedClass} md:translate-x-0`}`}><Sidebar onClose={() => setSidebarOpen(false)} onLogout={logout} /></div>
    {sidebarOpen && <div className="fixed inset-0 bg-black/60 z-40 md:hidden" onClick={() => setSidebarOpen(false)} />}
    <div className="flex-1 flex flex-col min-w-0"><Topbar onToggleSidebar={() => setSidebarOpen(!sidebarOpen)} sidebarOpen={sidebarOpen} user={user} /><main className="app-canvas flex-1 overflow-auto"><AnimatePresence mode="wait"><motion.div key={location.pathname} initial={{ opacity: 0, y: preferences.reduceMotion ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: preferences.reduceMotion ? 0 : -8 }} transition={{ duration: preferences.reduceMotion ? 0 : 0.15 }} className="h-full">{children}</motion.div></AnimatePresence></main></div>
    </div>
  </div>
}

function AccountPreferencesSync() {
  const { user } = useAuth()
  const { replacePreferences } = usePreferences()
  useEffect(() => {
    if (user?.preferences) replacePreferences(user.preferences)
  }, [replacePreferences, user?.id, user?.preferences])
  return null
}

function LocalizedToaster() {
  const { language } = usePreferences()
  return <Toaster position="top-center" richColors closeButton className="sonner-toast" dir={language === 'ar' ? 'rtl' : 'ltr'} />
}

const protectedPage = (page: React.ReactNode) => <ProtectedRoute><AppLayout>{page}</AppLayout></ProtectedRoute>

export default function App() {
  return <ThemeProvider><AuthProvider><AccountPreferencesSync /><AppErrorBoundary><Suspense fallback={<PageFallback />}><Routes>
    <Route path="/" element={<Landing />} />
    <Route path="/login" element={<Login />} />
    <Route path="/register" element={<Register />} />
    <Route path="/privacy" element={<Privacy />} />
    <Route path="/terms" element={<Terms />} />
    <Route path="/blog" element={<Blog />} />
    <Route path="/blog/:slug" element={<BlogArticle />} />
    <Route path="/dashboard" element={protectedPage(<RoleRoute roles={MANAGEMENT_ROLES}><Dashboard /></RoleRoute>)} />
    <Route path="/chat" element={<AppLayout><Chat /></AppLayout>} />
    <Route path="/chat/:chatId" element={<AppLayout><Chat /></AppLayout>} />
    <Route path="/providers" element={<AppLayout><Providers /></AppLayout>} />
    <Route path="/integrations" element={protectedPage(<RoleRoute roles={INTEGRATION_ROLES}><Integrations /></RoleRoute>)} />
    <Route path="/settings" element={protectedPage(<Settings />)} />
    <Route path="/admin/users" element={protectedPage(<RoleRoute roles={['owner']}><AdminUsers /></RoleRoute>)} />
    <Route path="/admin/content" element={protectedPage(<RoleRoute roles={CONTENT_ROLES}><ContentManager /></RoleRoute>)} />
    <Route path="*" element={<NotFound />} />
  </Routes></Suspense></AppErrorBoundary><LocalizedToaster /></AuthProvider></ThemeProvider>
}

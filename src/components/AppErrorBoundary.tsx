import React from 'react'

interface State { hasError: boolean }

export default class AppErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  render() {
    if (!this.state.hasError) return this.props.children
    const english = document.documentElement.lang === 'en'
    return <main className="app-canvas min-h-screen grid place-items-center p-6">
      <div className="card max-w-md p-8 text-center">
        <div className="w-12 h-12 rounded-2xl bg-red-500/10 text-red-500 grid place-items-center mx-auto mb-4 font-bold">!</div>
        <h1 className="text-xl font-semibold">{english ? 'Something went wrong' : 'حدث خطأ غير متوقع'}</h1>
        <p className="text-dark-500 mt-2 mb-5">{english ? 'Your data is safe. Reload the page to continue.' : 'بياناتك آمنة. أعد تحميل الصفحة للمتابعة.'}</p>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>{english ? 'Reload' : 'إعادة التحميل'}</button>
      </div>
    </main>
  }
}

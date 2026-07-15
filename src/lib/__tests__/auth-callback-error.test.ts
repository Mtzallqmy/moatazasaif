import { describe, expect, it, vi } from 'vitest'
import { clearAuthCallbackFailure, readAuthCallbackFailure } from '../auth-callback-error'

describe('OAuth callback failures', () => {
  it('explains an invalid provider client secret returned in the URL hash', () => {
    const failure = readAuthCallbackFailure('', '#error=server_error&error_code=unexpected_failure&error_description=Unable+to+exchange+external+code%3A+oauth2%3A+%22invalid_client%22+%22The+provided+client+secret+is+invalid.%22')
    expect(failure?.message).toContain('Client Secret')
    expect(failure?.description).toContain('invalid_client')
  })

  it('reads query-string failures and ignores successful token callbacks', () => {
    expect(readAuthCallbackFailure('?error=access_denied&error_description=cancelled', '')?.message).toContain('أُلغي')
    expect(readAuthCallbackFailure('', '#access_token=test&refresh_token=test')).toBeNull()
  })

  it('removes callback failures from browser history', () => {
    const replaceState = vi.fn()
    vi.stubGlobal('window', {
      location: { pathname: '/login', search: '?error=server_error' },
      history: { state: null, replaceState },
    })
    clearAuthCallbackFailure()
    expect(replaceState).toHaveBeenCalledWith(null, '', '/login')
    vi.unstubAllGlobals()
  })
})

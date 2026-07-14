import { waitUntil as vercelWaitUntil } from '@vercel/functions'
import { logTechnicalError } from '../redaction'

export function scheduleTelegramWork(task: Promise<void>) {
  const guarded = task.catch((error) => {
    logTechnicalError('[telegram-background-failed]', error)
  })
  try {
    vercelWaitUntil(guarded)
  } catch {
    // Local Vercel emulators do not always provide the request context needed
    // by waitUntil. The promise is still observed and allowed to finish.
    void guarded
  }
}

import { getAdminClient } from './supabase.js'
import { logTechnicalError, redactUnknown } from './redaction.js'

export async function recordAudit(actorId: string | null, targetUserId: string | null, action: string, details: Record<string, unknown> = {}) {
  const { error } = await getAdminClient().from('audit_logs').insert({
    actor_id: actorId,
    target_user_id: targetUserId,
    action,
    details: redactUnknown(details),
  })
  if (error) logTechnicalError('[audit-log-failed]', error, { action, actorId, targetUserId })
}

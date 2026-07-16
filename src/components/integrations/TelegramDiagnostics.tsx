import { AlertTriangle, CheckCircle, XCircle, type LucideIcon } from "lucide-react";
import { usePreferences } from "../../contexts/PreferencesContext";
import type { TelegramDiagnostic } from "../../features/integrations/telegram-types";

export function LayerStatus({ icon: Icon, ok, label, detail }: { icon: LucideIcon; ok: boolean; label: string; detail: string }) {
  return (
    <div className="integration-layer">
      <span className={ok ? "is-ok" : "is-warning"}><Icon size={16} /></span>
      <div><strong>{label}</strong><small>{detail}</small></div>
      <i className={ok ? "is-ok" : "is-warning"} aria-hidden="true" />
    </div>
  );
}

export function DiagnosticPanel({ diagnostic }: { diagnostic: TelegramDiagnostic }) {
  const { language, tr } = usePreferences();
  const state = diagnostic.overall === "healthy"
    ? { icon: CheckCircle, label: tr("كل الطبقات جاهزة", "All layers ready"), className: "healthy" }
    : diagnostic.overall === "degraded"
      ? { icon: AlertTriangle, label: tr("الاتصال يعمل مع تنبيهات", "Connected with warnings"), className: "degraded" }
      : { icon: XCircle, label: tr("الاتصال متوقف", "Connection offline"), className: "offline" };
  const StateIcon = state.icon;
  return (
    <section className={`telegram-diagnostic ${state.className}`} aria-live="polite">
      <header>
        <div><StateIcon size={18} /><strong>{state.label}</strong></div>
        <small>{tr("آخر 24 ساعة", "Last 24 hours")}</small>
      </header>
      <div className="diagnostic-stats">
        <span><strong>{diagnostic.activity.received24h}</strong>{tr("مستلم", "Received")}</span>
        <span><strong>{diagnostic.activity.processed24h}</strong>{tr("معالج", "Processed")}</span>
        <span><strong>{diagnostic.activity.failed24h}</strong>{tr("فاشل", "Failed")}</span>
        <span><strong>{diagnostic.webhook.pendingUpdateCount}</strong>{tr("معلّق", "Pending")}</span>
      </div>
      <div className="diagnostic-checks">
        {diagnostic.checks.map((check) => (
          <div key={check.key}>
            {check.ok ? <CheckCircle size={15} /> : <AlertTriangle size={15} />}
            <span><strong>{language === "ar" ? check.labelAr : check.labelEn}</strong><small>{language === "ar" ? check.detailAr : check.detailEn}</small></span>
          </div>
        ))}
      </div>
      {diagnostic.recommendations.length > 0 && (
        <div className="diagnostic-recommendations">
          {diagnostic.recommendations.map((item) => <p key={item}>• {item}</p>)}
        </div>
      )}
    </section>
  );
}

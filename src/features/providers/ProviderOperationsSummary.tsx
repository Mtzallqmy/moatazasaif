import { Activity, ArrowUpLeft, Clock3, Gauge, RefreshCw, ShieldCheck } from "lucide-react";
import { usePreferences } from "../../contexts/PreferencesContext";
import type { Provider } from "../../types";

interface ProviderOperationsSummaryProps {
  providers: Provider[];
  loading: boolean;
  canOpenDiagnostics: boolean;
  onRefresh: () => void;
  onOpenDiagnostics: () => void;
}

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle];
}

export function ProviderOperationsSummary({
  providers,
  loading,
  canOpenDiagnostics,
  onRefresh,
  onOpenDiagnostics,
}: ProviderOperationsSummaryProps) {
  const { tr } = usePreferences();
  const connected = providers.filter((provider) => provider.status === "connected").length;
  const healthy = providers.filter((provider) => provider.healthStatus === "healthy").length;
  const openCircuits = providers.filter((provider) => provider.circuit?.state === "open").length;
  const measuredAvailability = providers
    .map((provider) => provider.availability)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const availability = measuredAvailability.length
    ? Math.round((measuredAvailability.reduce((sum, value) => sum + value, 0) / measuredAvailability.length) * 100)
    : providers.length
      ? Math.round((connected / providers.length) * 100)
      : 0;
  const latency = median(
    providers
      .map((provider) => provider.latency ?? provider.lastLatencyMs ?? provider.diagnostic?.latencyMs)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value)),
  );
  const healthLabel = providers.length === 0
    ? tr("بانتظار أول مزود", "Waiting for the first provider")
    : openCircuits > 0
      ? tr("توجد دائرة حماية مفتوحة", "A protection circuit is open")
      : healthy > 0 || connected === providers.length
        ? tr("مسار التوليد جاهز", "Generation path is ready")
        : tr("تحتاج المزودات إلى فحص", "Providers need a health check");

  return (
    <section className="provider-operations-hero" aria-labelledby="provider-operations-title">
      <div className="provider-operations-glow" aria-hidden="true" />
      <div className="provider-operations-head">
        <div>
          <div className="provider-operations-kicker">
            <Activity size={15} aria-hidden="true" />
            {tr("مركز تشغيل الذكاء الاصطناعي", "AI operations center")}
          </div>
          <h1 id="provider-operations-title">
            {tr("مزود أسرع، واستجابة أكثر ثباتًا.", "Faster providers. More resilient responses.")}
          </h1>
          <p>
            {tr(
              "رتّب المزودات حسب صحتها، راقب زمن الاستجابة، وانتقل تلقائيًا إلى البديل الآمن قبل بدء الرد.",
              "Prioritize providers by health, watch latency, and fail over safely before a response begins.",
            )}
          </p>
        </div>
        <div className={`provider-readiness ${openCircuits > 0 ? "is-warning" : "is-ready"}`} aria-live="polite">
          <ShieldCheck size={18} aria-hidden="true" />
          <span>{healthLabel}</span>
        </div>
      </div>

      <div className="provider-operations-metrics">
        <div>
          <ShieldCheck size={18} aria-hidden="true" />
          <strong>{connected}/{providers.length}</strong>
          <small>{tr("متصل", "connected")}</small>
        </div>
        <div>
          <Gauge size={18} aria-hidden="true" />
          <strong>{availability}%</strong>
          <small>{tr("متوسط التوفر", "availability")}</small>
        </div>
        <div>
          <Clock3 size={18} aria-hidden="true" />
          <strong>{latency == null ? "—" : `${latency} ms`}</strong>
          <small>{tr("وسيط الاستجابة", "median latency")}</small>
        </div>
        <div>
          <Activity size={18} aria-hidden="true" />
          <strong>{openCircuits}</strong>
          <small>{tr("دوائر مفتوحة", "open circuits")}</small>
        </div>
      </div>

      <div className="provider-operations-actions">
        <button type="button" className="btn provider-hero-button" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} aria-hidden="true" />
          {tr("تحديث الحالة", "Refresh status")}
        </button>
        {canOpenDiagnostics && (
          <button type="button" className="btn provider-hero-button" onClick={onOpenDiagnostics}>
            {tr("التشخيص المتقدم", "Advanced diagnostics")}
            <ArrowUpLeft size={15} aria-hidden="true" />
          </button>
        )}
      </div>
    </section>
  );
}

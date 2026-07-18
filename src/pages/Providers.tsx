import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Clock3,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  XCircle,
  Shield,
  Eraser,
  KeyRound,
  Search,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  PROVIDER_DEFINITIONS,
  type ProviderProtocol,
} from "../../shared/provider-registry";
import { apiJson, authHeaders } from "../lib/api";
import {
  clearSessionData,
  getSessionProvider,
  saveSessionProvider,
  type SessionProviderCredential,
} from "../lib/session-provider";
import { useAuth } from "../contexts/AuthContext";
import { usePreferences } from "../contexts/PreferencesContext";
import type { Provider, ProviderDiagnostic, ProviderType } from "../types";
import PlatformProviderPanel from "../features/providers/PlatformProviderPanel";
import { ProviderOperationsSummary } from "../features/providers/ProviderOperationsSummary";

const categoryLabels: Record<string, readonly [string, string]> = {
  authentication: ["فشل المصادقة", "Authentication failed"],
  authorization: ["صلاحية غير كافية", "Insufficient permissions"],
  rate_limit: ["تجاوز الحد", "Rate limit exceeded"],
  quota: ["نفد الرصيد", "Quota exhausted"],
  model: ["النموذج غير موجود", "Model not found"],
  endpoint: ["Base URL/Endpoint غير صحيح", "Invalid Base URL/Endpoint"],
  validation: ["صيغة الطلب", "Invalid request"],
  network: ["المزود غير متاح", "Provider unavailable"],
  timeout: ["انتهت المهلة", "Request timed out"],
  upstream: ["خطأ من خادم المزود", "Provider server error"],
  unknown: ["غير مصنف", "Unclassified"],
};

type FormState = {
  name: string;
  type: ProviderType;
  protocol: ProviderProtocol;
  apiKey: string;
  baseUrl: string;
  model: string;
};
const emptyForm: FormState = {
  name: "",
  type: "openai",
  protocol: "openai-compatible",
  apiKey: "",
  baseUrl: "",
  model: "",
};

export default function Providers() {
  const { user } = useAuth();
  const { tr } = usePreferences();
  const navigate = useNavigate();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [sessionProvider, setSessionProvider] =
    useState<SessionProviderCredential | null>(() => getSessionProvider());
  const [showAddModal, setShowAddModal] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [credentialMode, setCredentialMode] = useState<"session" | "saved">(
    "session",
  );
  const [providerQuery, setProviderQuery] = useState("");
  const [providerSort, setProviderSort] = useState<"priority" | "name" | "latency">("priority");
  const [keyRotationProvider, setKeyRotationProvider] = useState<Provider | null>(null);
  const [replacementKey, setReplacementKey] = useState("");

  const definitions =
    PROVIDER_DEFINITIONS as readonly (typeof PROVIDER_DEFINITIONS)[number][];
  const selectedDefinition = useMemo(
    () => definitions.find((item) => item.type === form.type),
    [definitions, form.type],
  );
  const needsBaseUrl = Boolean(selectedDefinition?.requiresCustomBaseUrl);
  const isCustom = form.type === "custom";
  const visibleProviders = useMemo(() => providers.filter((provider) => `${provider.name} ${provider.type} ${provider.model || ""}`.toLowerCase().includes(providerQuery.toLowerCase())).sort((left, right) => providerSort === "name" ? left.name.localeCompare(right.name) : providerSort === "latency" ? (left.latency || Number.MAX_SAFE_INTEGER) - (right.latency || Number.MAX_SAFE_INTEGER) : (left.priority || 100) - (right.priority || 100)), [providerQuery, providerSort, providers]);

  const loadProviders = async () => {
    if (!user) {
      setProviders([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const body = await apiJson<{ providers: Provider[] }>("/api/providers", {
        headers: await authHeaders(false),
      });
      setProviders(body.providers || []);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : tr("تعذر تحميل المزودات", "Could not load providers"),
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadProviders();
    const handler = () => setSessionProvider(getSessionProvider());
    window.addEventListener("moataz:session-provider-changed", handler);
    return () =>
      window.removeEventListener("moataz:session-provider-changed", handler);
  }, [user]);

  const testSessionConfig = async (config: {
    type: ProviderType;
    protocol?: ProviderProtocol;
    apiKey: string;
    baseUrl?: string;
    model?: string;
  }) => {
    const body = await apiJson<ProviderDiagnostic>("/api/providers/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credentialMode: "session", provider: config }),
    });
    return body;
  };

  const addProvider = async () => {
    if (!form.name.trim() || !form.apiKey.trim()) {
      toast.error(
        tr(
          "الاسم ومفتاح API مطلوبان",
          "Provider name and API key are required",
        ),
      );
      return;
    }
    if (credentialMode === "saved" && !user) {
      toast.error(
        tr(
          "سجّل الدخول لحفظ المفتاح مشفّرًا، أو اختر الجلسة المؤقتة",
          "Sign in to store the key encrypted, or use a temporary session",
        ),
      );
      return;
    }
    if (needsBaseUrl && !form.baseUrl.trim()) {
      toast.error(
        tr(
          "Base URL مطلوب لهذا النوع",
          "A Base URL is required for this provider",
        ),
      );
      return;
    }
    setTestingId("new");
    try {
      if (credentialMode === "session") {
        const diagnostic = await testSessionConfig({
          type: form.type,
          protocol: isCustom ? form.protocol : undefined,
          apiKey: form.apiKey,
          baseUrl: form.baseUrl || undefined,
          model: form.model || undefined,
        });
        if (!diagnostic.success)
          throw Object.assign(
            new Error(diagnostic.providerMessage || diagnostic.message),
            { details: diagnostic },
          );
        const stored = saveSessionProvider({
          name: form.name.trim(),
          type: form.type,
          protocol: diagnostic.detectedProtocol,
          baseUrl: form.baseUrl || selectedDefinition?.defaultBaseUrl || "",
          apiKey: form.apiKey,
          model: diagnostic.testedModel || form.model || diagnostic.models[0],
          models: diagnostic.models,
          status: "connected",
          diagnostic,
          lastTested: new Date().toISOString(),
        });
        setSessionProvider(stored);
        toast.success(
          tr(
            "تم اختبار المزود فعليًا وحُفظ للمحاولة الحالية فقط",
            "Provider verified and kept for this session only",
          ),
        );
      } else {
        const created = await apiJson<{ provider: Provider }>(
          "/api/providers",
          {
            method: "POST",
            headers: await authHeaders(),
            body: JSON.stringify({
              credentialMode: "saved",
              name: form.name,
              type: form.type,
              protocol: isCustom ? form.protocol : undefined,
              apiKey: form.apiKey,
              baseUrl: form.baseUrl || undefined,
              model: form.model || undefined,
            }),
          },
        );
        // The saved path is tested through providerId after encryption and
        // ownership validation; do not report success from an ephemeral
        // preflight request.
        let diagnostic: ProviderDiagnostic;
        try {
          diagnostic = await apiJson<ProviderDiagnostic>(
            "/api/providers/test",
            {
              method: "POST",
              headers: await authHeaders(),
              body: JSON.stringify({
                credentialMode: "saved",
                providerId: created.provider.id,
              }),
            },
          );
        } catch (error: any) {
          const failed = error?.details as ProviderDiagnostic | undefined;
          setProviders((current) => [
            {
              ...created.provider,
              status: "error",
              diagnostic: failed,
              models: failed?.models || [],
              detectedProtocol: failed?.detectedProtocol,
              lastLatencyMs: failed?.latencyMs,
              lastHttpStatus: failed?.httpStatus,
              errorMessage: failed?.providerMessage || error?.message,
            },
            ...current,
          ]);
          setExpandedId(created.provider.id);
          throw Object.assign(
            new Error(
              failed?.providerMessage ||
                error?.message ||
                tr("فشل اختبار المزود المحفوظ", "Saved provider test failed"),
            ),
            { details: failed },
          );
        }
        const savedProvider: Provider = {
          ...created.provider,
          status: "connected",
          models: diagnostic.models,
          model:
            diagnostic.testedModel ||
            created.provider.model ||
            diagnostic.models[0],
          diagnostic,
          detectedProtocol: diagnostic.detectedProtocol,
          lastLatencyMs: diagnostic.latencyMs,
          lastHttpStatus: diagnostic.httpStatus,
          lastTested: new Date().toISOString(),
        };
        setProviders((current) => [savedProvider, ...current]);
        toast.success(
          tr(
            "تم اختبار المزود المحفوظ فعليًا وحفظ المفتاح مشفّرًا داخل حسابك",
            "Saved provider verified and its key encrypted in your account",
          ),
        );
      }
      setShowAddModal(false);
      setForm(emptyForm);
    } catch (error: any) {
      const diagnostic = error?.details as ProviderDiagnostic | undefined;
      toast.error(
        diagnostic?.providerMessage ||
          error?.message ||
          tr("فشل اختبار المزود", "Provider test failed"),
      );
    } finally {
      setTestingId(null);
    }
  };

  const testSavedProvider = async (provider: Provider) => {
    setTestingId(provider.id);
    try {
      const body = await apiJson<ProviderDiagnostic>("/api/providers/test", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          credentialMode: "saved",
          providerId: provider.id,
        }),
      });
      const updated = {
        ...provider,
        status: body.success ? ("connected" as const) : ("error" as const),
        models: body.models,
        diagnostic: body,
        detectedProtocol: body.detectedProtocol,
        lastLatencyMs: body.latencyMs,
        lastHttpStatus: body.httpStatus,
        lastTested: new Date().toISOString(),
        errorMessage: body.success ? undefined : body.providerMessage,
      };
      setProviders((current) =>
        current.map((item) => (item.id === provider.id ? updated : item)),
      );
      setExpandedId(provider.id);
      if (body.success) toast.success(body.message);
      else toast.error(body.providerMessage || body.message);
    } catch (error: any) {
      const diagnostic = error?.details as ProviderDiagnostic | undefined;
      setProviders((current) =>
        current.map((item) =>
          item.id === provider.id
            ? {
                ...item,
                status: "error",
                diagnostic,
                errorMessage: diagnostic?.providerMessage || error.message,
              }
            : item,
        ),
      );
      setExpandedId(provider.id);
      toast.error(
        diagnostic?.providerMessage ||
          error.message ||
          tr("فشل الاتصال", "Connection failed"),
      );
    } finally {
      setTestingId(null);
    }
  };

  const discoverSavedProvider = async (provider: Provider) => {
    setTestingId(`discover:${provider.id}`);
    try {
      const body = await apiJson<{ models: string[]; message?: string }>('/api/providers/diagnostics', {
        method: 'POST', headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'discover', providerId: provider.id }),
      });
      setProviders((current) => current.map((item) => item.id === provider.id ? { ...item, models: body.models, status: 'connected' } : item));
      setExpandedId(provider.id);
      toast.success(body.message || tr('تم اكتشاف النماذج', 'Models discovered'));
    } catch (error) { toast.error(error instanceof Error ? error.message : tr('تعذر اكتشاف النماذج', 'Could not discover models')); }
    finally { setTestingId(null); }
  };

  const testSessionProvider = async () => {
    if (!sessionProvider) return;
    setTestingId("session");
    try {
      const diagnostic = await testSessionConfig({
        type: sessionProvider.type,
        protocol: sessionProvider.protocol,
        apiKey: sessionProvider.apiKey,
        baseUrl: sessionProvider.baseUrl,
        model: sessionProvider.model,
      });
      const updated = {
        ...sessionProvider,
        status: diagnostic.success
          ? ("connected" as const)
          : ("error" as const),
        diagnostic,
        models: diagnostic.models,
        model: diagnostic.testedModel || sessionProvider.model,
        lastTested: new Date().toISOString(),
      };
      saveSessionProvider(updated);
      setSessionProvider(updated);
      setExpandedId("session");
      if (diagnostic.success) toast.success(diagnostic.message);
      else toast.error(diagnostic.providerMessage || diagnostic.message);
    } catch (error: any) {
      const diagnostic = error?.details as ProviderDiagnostic | undefined;
      if (diagnostic) {
        const updated = {
          ...sessionProvider,
          status: "error" as const,
          diagnostic,
          models: diagnostic.models || [],
          lastTested: new Date().toISOString(),
        };
        saveSessionProvider(updated);
        setSessionProvider(updated);
        setExpandedId("session");
      }
      toast.error(
        diagnostic?.providerMessage ||
          diagnostic?.message ||
          error.message ||
          tr("فشل الاتصال", "Connection failed"),
      );
    } finally {
      setTestingId(null);
    }
  };

  const deleteProvider = async (id: string) => {
    if (
      !confirm(
        tr(
          "حذف المزود المحفوظ نهائيًا؟",
          "Permanently delete this saved provider?",
        ),
      )
    )
      return;
    try {
      await apiJson("/api/providers", {
        method: "DELETE",
        headers: await authHeaders(),
        body: JSON.stringify({ id }),
      });
      setProviders((current) => current.filter((item) => item.id !== id));
      toast.success(tr("تم حذف المزود", "Provider deleted"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : tr("تعذر حذف المزود", "Could not delete provider"),
      );
    }
  };

  const clearSession = async () => {
    try {
      await clearSessionData();
      setSessionProvider(null);
      toast.success(
        tr(
          "تم مسح مفتاح الجلسة والمحادثات المحلية",
          "Session key and local chats cleared",
        ),
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : tr("تعذر مسح بيانات الجلسة", "Could not clear session data"),
      );
    }
  };

  const updateModel = async (provider: Provider, model: string) => {
    try {
      const body = await apiJson<{ provider: Provider }>("/api/providers", {
        method: "PATCH",
        headers: await authHeaders(),
        body: JSON.stringify({ id: provider.id, model }),
      });
      setProviders((current) =>
        current.map((item) => (item.id === provider.id ? body.provider : item)),
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : tr("تعذر تحديث النموذج", "Could not update the model"),
      );
    }
  };

  const rotateProviderKey = async () => {
    if (!keyRotationProvider || replacementKey.trim().length < 8) {
      toast.error(tr("أدخل مفتاح API صالحًا", "Enter a valid API key"));
      return;
    }
    setTestingId(`rotate:${keyRotationProvider.id}`);
    try {
      await apiJson<{ provider: Provider }>("/api/providers", {
        method: "PATCH",
        headers: await authHeaders(),
        body: JSON.stringify({ id: keyRotationProvider.id, apiKey: replacementKey.trim() }),
      });
      setReplacementKey("");
      setKeyRotationProvider(null);
      await testSavedProvider(keyRotationProvider);
      toast.success(tr("تم استبدال المفتاح واختبار الاتصال", "Key replaced and connection verified"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tr("تعذر استبدال المفتاح", "Could not replace the key"));
    } finally {
      setTestingId(null);
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <ProviderOperationsSummary
        providers={providers}
        loading={loading}
        canOpenDiagnostics={Boolean(user && ["owner", "admin", "manager"].includes(user.role))}
        onRefresh={() => void loadProviders()}
        onOpenDiagnostics={() => navigate("/developer/diagnostics")}
      />
      <div className="provider-page-toolbar">
        <div>
          <h2>{tr("اتصالات المزودات", "Provider connections")}</h2>
          <p>{tr("اختبار حي، اكتشاف للنماذج، وحفظ مشفّر للمفاتيح.", "Live verification, model discovery, and encrypted key storage.")}</p>
        </div>
        <button type="button" onClick={() => setShowAddModal(true)} className="btn btn-primary">
          <Plus size={18} /> {tr("إضافة مزود", "Add provider")}
        </button>
      </div>
      <div className="card p-4 mb-6 border-primary-500/30 bg-primary-500/5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Shield size={18} className="text-primary-400" />
          <div>
            <div className="font-medium">
              {tr("وضع الجلسة المؤقتة", "Temporary session mode")}
            </div>
            <p className="text-xs text-dark-400">
              {tr(
                "المفتاح في sessionStorage فقط، والمحادثات في IndexedDB على هذا الجهاز.",
                "The key stays in sessionStorage and chats remain in IndexedDB on this device.",
              )}
            </p>
          </div>
        </div>
        <button
          onClick={() => void clearSession()}
          className="btn btn-secondary text-xs"
        >
          <Eraser size={14} /> {tr("مسح بيانات الجلسة", "Clear session data")}
        </button>
      </div>
      {user?.role === "owner" && <PlatformProviderPanel providers={providers} onChanged={() => void loadProviders()} />}
      {sessionProvider && (
        <ProviderCard
          provider={{ ...sessionProvider, credentialMode: "session" }}
          isSession
          onTest={() => void testSessionProvider()}
          testing={testingId === "session"}
          expanded={expandedId === "session"}
          onExpand={() =>
            setExpandedId(expandedId === "session" ? null : "session")
          }
          onStart={() => navigate("/chat")}
          onDelete={() => void clearSession()}
          onModelChange={(model) => {
            const next = { ...sessionProvider, model };
            saveSessionProvider(next);
            setSessionProvider(next);
          }}
        />
      )}
      {user && (
        <>
          {loading ? (
            <div className="card p-12 text-center text-dark-400" role="status">
              {tr(
                "جارٍ تحميل المزودات المحفوظة...",
                "Loading saved providers...",
              )}
            </div>
          ) : providers.length === 0 ? (
            <div className="card p-10 text-center text-dark-400">
              {tr(
                "لا يوجد مزود محفوظ. أضف واحدًا بعد تسجيل الدخول.",
                "No saved providers yet. Add one after signing in.",
              )}
            </div>
          ) : (
            <>
              <div className="provider-filter-bar">
                <label className="provider-search-field">
                  <Search size={17} aria-hidden="true" />
                  <span className="sr-only">{tr("بحث في المزودات", "Search providers")}</span>
                  <input value={providerQuery} onChange={(event) => setProviderQuery(event.target.value)} placeholder={tr("ابحث بالاسم أو النوع أو النموذج", "Search name, type, or model")} />
                </label>
                <label className="provider-sort-field">
                  <span>{tr("الترتيب", "Sort")}</span>
                  <select value={providerSort} onChange={(event) => setProviderSort(event.target.value as typeof providerSort)}>
                    <option value="priority">{tr("حسب الأولوية", "By priority")}</option>
                    <option value="name">{tr("حسب الاسم", "By name")}</option>
                    <option value="latency">{tr("حسب السرعة", "By latency")}</option>
                  </select>
                </label>
              </div>
              {visibleProviders.length === 0 ? (
                <div className="card provider-empty-filter" role="status">
                  <Search size={26} aria-hidden="true" />
                  <strong>{tr("لا توجد نتيجة مطابقة", "No matching provider")}</strong>
                  <span>{tr("جرّب اسمًا أو نموذجًا آخر.", "Try another name or model.")}</span>
                </div>
              ) : <div className="grid gap-4">
                {visibleProviders.map((provider) => (
                <ProviderCard
                  key={provider.id}
                  provider={provider}
                  onTest={() => void testSavedProvider(provider)}
                  onDiscover={() => void discoverSavedProvider(provider)}
                  testing={testingId === provider.id}
                  expanded={expandedId === provider.id}
                  onExpand={() =>
                    setExpandedId(
                      expandedId === provider.id ? null : provider.id,
                    )
                  }
                  onDelete={() => void deleteProvider(provider.id)}
                  onRotateKey={() => {
                    setReplacementKey("");
                    setKeyRotationProvider(provider);
                  }}
                  onStart={() => navigate("/chat")}
                  onModelChange={(model) => void updateModel(provider, model)}
                />
                ))}
              </div>}
            </>
          )}
        </>
      )}
      {!user && !sessionProvider && (
        <div className="card p-12 text-center">
          <Bot
            className="mx-auto text-dark-600 mb-4"
            size={48}
            aria-hidden="true"
          />
          <h3 className="text-xl font-medium mb-2">
            {tr("ابدأ بوضع جلسة مؤقتة", "Start with a temporary session")}
          </h3>
          <p className="text-dark-400">
            {tr(
              "لا تحتاج إلى حساب لاختبار مفتاحك وبدء محادثة حقيقية.",
              "You do not need an account to test a key and start a live chat.",
            )}
          </p>
        </div>
      )}

      {showAddModal && (
        <div className="modal" onClick={() => setShowAddModal(false)}>
          <div
            className="modal-content p-8 max-w-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-provider-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="add-provider-title" className="text-2xl font-semibold mb-5">
              {tr("إضافة مزود واختباره", "Add and verify a provider")}
            </h2>
            <div className="flex gap-2 p-1 rounded-2xl bg-dark-800 mb-5">
              <button
                className={`flex-1 py-2 rounded-xl text-sm ${credentialMode === "session" ? "bg-primary-600 text-white" : "text-dark-400"}`}
                onClick={() => setCredentialMode("session")}
              >
                {tr(
                  "جلسة مؤقتة — لا يتم الحفظ",
                  "Temporary session — not saved",
                )}
              </button>
              <button
                className={`flex-1 py-2 rounded-xl text-sm ${credentialMode === "saved" ? "bg-primary-600 text-white" : "text-dark-400"}`}
                onClick={() => setCredentialMode("saved")}
                disabled={!user}
              >
                {tr("حفظ مشفّر في الحساب", "Encrypted account storage")}
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="provider-name"
                  className="text-sm text-dark-300 block mb-1.5"
                >
                  {tr("اسم المزود", "Provider name")}
                </label>
                <input
                  id="provider-name"
                  className="input"
                  value={form.name}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                  placeholder={tr("OpenAI الخاص بي", "My OpenAI")}
                />
              </div>
              <div>
                <label
                  htmlFor="provider-type"
                  className="text-sm text-dark-300 block mb-1.5"
                >
                  {tr("نوع المزود", "Provider type")}
                </label>
                <select
                  id="provider-type"
                  className="input"
                  value={form.type}
                  onChange={(event) => {
                    const type = event.target.value as ProviderType;
                    const definition = definitions.find(
                      (item) => item.type === type,
                    );
                    setForm({
                      ...form,
                      type,
                      protocol: definition?.protocol || "openai-compatible",
                      baseUrl: "",
                    });
                  }}
                >
                  {definitions.map((item) => (
                    <option key={item.type} value={item.type}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
              {isCustom && (
                <div>
                  <label
                    htmlFor="provider-protocol"
                    className="text-sm text-dark-300 block mb-1.5"
                  >
                    {tr("البروتوكول", "Protocol")}
                  </label>
                  <select
                    id="provider-protocol"
                    className="input"
                    value={form.protocol}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        protocol: event.target.value as ProviderProtocol,
                      })
                    }
                  >
                    {(
                      ["openai-compatible", "gemini", "anthropic"] as const
                    ).map((protocol) => (
                      <option key={protocol} value={protocol}>
                        {protocol}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label
                  htmlFor="provider-base-url"
                  className="text-sm text-dark-300 block mb-1.5"
                >
                  Base URL {needsBaseUrl ? "*" : tr("(اختياري)", "(optional)")}
                </label>
                <input
                  id="provider-base-url"
                  className="input font-mono text-sm"
                  dir="ltr"
                  value={form.baseUrl}
                  onChange={(event) =>
                    setForm({ ...form, baseUrl: event.target.value })
                  }
                  placeholder={
                    selectedDefinition?.defaultBaseUrl ||
                    "https://api.example.com/v1"
                  }
                />
              </div>
              <div>
                <label
                  htmlFor="provider-api-key"
                  className="text-sm text-dark-300 block mb-1.5"
                >
                  API Key
                </label>
                <input
                  id="provider-api-key"
                  type="password"
                  autoComplete="new-password"
                  className="input font-mono text-sm"
                  dir="ltr"
                  value={form.apiKey}
                  onChange={(event) =>
                    setForm({ ...form, apiKey: event.target.value })
                  }
                />
              </div>
              <div>
                <label
                  htmlFor="provider-model"
                  className="text-sm text-dark-300 block mb-1.5"
                >
                  {tr("النموذج (اختياري)", "Model (optional)")}
                </label>
                <input
                  id="provider-model"
                  className="input"
                  dir="ltr"
                  value={form.model}
                  onChange={(event) =>
                    setForm({ ...form, model: event.target.value })
                  }
                  placeholder={tr(
                    form.type === "zyloo" ? "مثال: zyloo/kimi-k3" : "يُستخدم إذا لم تدعم /models",
                    form.type === "zyloo" ? "Example: zyloo/kimi-k3" : "Used when /models is unavailable",
                  )}
                />
                {form.type === "zyloo" && <p className="text-xs text-dark-500 mt-2">{tr("استخدم معرّف Zyloo القانوني الذي يبدأ بـ zyloo/؛ سيتم تصحيح moonshotai/kimi-k3 القديم تلقائيًا.", "Use the canonical Zyloo ID beginning with zyloo/; the legacy moonshotai/kimi-k3 alias is corrected automatically.")}</p>}
              </div>
            </div>
            <div className="flex gap-3 mt-7">
              <button
                onClick={() => setShowAddModal(false)}
                className="btn btn-secondary flex-1"
              >
                {tr("إلغاء", "Cancel")}
              </button>
              <button
                onClick={() => void addProvider()}
                disabled={testingId === "new"}
                className="btn btn-primary flex-1"
              >
                {testingId === "new" ? (
                  <>
                    <RefreshCw className="animate-spin" size={15} />{" "}
                    {tr("جارٍ اختبار فعلي...", "Running live test...")}
                  </>
                ) : (
                  tr("اختبار وحفظ", "Test and save")
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      {keyRotationProvider && (
        <div className="modal" onClick={() => setKeyRotationProvider(null)}>
          <div className="modal-content p-7 max-w-md" role="dialog" aria-modal="true" aria-labelledby="replace-provider-key-title" onClick={(event) => event.stopPropagation()}>
            <h2 id="replace-provider-key-title" className="text-xl font-semibold mb-2">
              {tr("استبدال مفتاح المزود", "Replace provider key")}
            </h2>
            <p className="text-sm text-dark-400 mb-5">
              {tr(`سيُشفّر المفتاح الجديد ويُختبر دون إظهار المفتاح السابق — ${keyRotationProvider.name}`, `The new key will be encrypted and tested without exposing the previous key — ${keyRotationProvider.name}`)}
            </p>
            <label htmlFor="replacement-provider-key" className="text-sm block mb-1.5">API Key</label>
            <input id="replacement-provider-key" type="password" autoComplete="new-password" dir="ltr" className="input font-mono" value={replacementKey} onChange={(event) => setReplacementKey(event.target.value)} />
            <div className="flex gap-3 mt-6">
              <button className="btn btn-secondary flex-1" onClick={() => setKeyRotationProvider(null)}>{tr("إلغاء", "Cancel")}</button>
              <button className="btn btn-primary flex-1" disabled={testingId === `rotate:${keyRotationProvider.id}`} onClick={() => void rotateProviderKey()}>
                <KeyRound size={15} /> {tr("استبدال واختبار", "Replace & test")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type CardProvider = Provider | SessionProviderCredential;
function ProviderCard({
  provider,
  isSession = false,
  onTest,
  onDiscover,
  testing,
  expanded,
  onExpand,
  onDelete,
  onRotateKey,
  onStart,
  onModelChange,
}: {
  provider: CardProvider;
  isSession?: boolean;
  onTest: () => void;
  onDiscover?: () => void;
  testing: boolean;
  expanded: boolean;
  onExpand: () => void;
  onDelete: () => void;
  onRotateKey?: () => void;
  onStart: () => void;
  onModelChange: (model: string) => void;
}) {
  const { tr } = usePreferences();
  const definition = PROVIDER_DEFINITIONS.find(
    (item) => item.type === provider.type,
  );
  const diagnostic = provider.diagnostic;
  const models = provider.models || [];
  const managedProvider = isSession ? undefined : provider as Provider;
  const effectiveStatus = testing
    ? "testing"
    : managedProvider?.healthStatus === "offline" || managedProvider?.circuit?.state === "open"
      ? "error"
      : managedProvider?.healthStatus === "healthy"
        ? "connected"
        : provider.status;
  const latency = managedProvider?.latency ?? managedProvider?.lastLatencyMs ?? diagnostic?.latencyMs;
  return (
    <div className="card provider-connection-card overflow-hidden mb-4">
      <div className="p-5 flex flex-col md:flex-row md:items-center gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-1">
            <div className="font-semibold text-lg">{provider.name}</div>
            <StatusBadge status={effectiveStatus} />
          </div>
          <div className="text-sm text-dark-400">
            {definition?.label || provider.type} • {provider.protocol} •{" "}
            {provider.model || tr("لم يُحدد نموذج", "No model selected")}
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-dark-500 mt-2">
            {diagnostic?.endpoint && (
              <span dir="ltr">Endpoint: {diagnostic.endpoint}</span>
            )}
            {latency !== undefined && latency !== null && (
              <span>
                <Clock3 size={12} className="inline" /> {latency}ms
              </span>
            )}
            {diagnostic?.httpStatus && (
              <span>HTTP {diagnostic.httpStatus}</span>
            )}
            {managedProvider?.healthStatus && <span>{tr('الصحة', 'Health')}: {managedProvider.healthStatus}</span>}
            {managedProvider?.availability !== undefined && <span>{tr('التوفر', 'Availability')}: {Math.round(managedProvider.availability * 100)}%</span>}
            {managedProvider?.circuit && <span>{tr('الدائرة', 'Circuit')}: {managedProvider.circuit.state}</span>}
            {managedProvider?.timeout && <span>{tr('المهلة', 'Timeout')}: {Math.round(managedProvider.timeout / 1000)}s</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onTest}
            disabled={testing}
            className="btn btn-secondary text-xs px-4 py-2"
          >
            {testing ? (
              <>
                <RefreshCw className="animate-spin" size={14} />{" "}
                {tr("جارٍ الاختبار", "Testing...")}
              </>
            ) : (
              <>
                <Play size={14} /> {tr("اختبار واكتشاف", "Test and discover")}
              </>
            )}
          </button>
          {onRotateKey && (
            <button onClick={onRotateKey} className="btn btn-ghost p-2" aria-label={tr("استبدال مفتاح API", "Replace API key")} title={tr("استبدال مفتاح API", "Replace API key")}>
              <KeyRound size={17} />
            </button>
          )}
          {onDiscover && <button onClick={onDiscover} disabled={testing} className="btn btn-secondary text-xs px-3 py-2"><Search size={14} /> {tr("اكتشاف النماذج", "Discover models")}</button>}
          {models.length > 0 && (
            <select
              aria-label={tr("اختيار نموذج", "Select model")}
              value={provider.model || ""}
              onChange={(event) => onModelChange(event.target.value)}
              className="input text-xs py-2 px-3 w-auto max-w-64"
            >
              <option value="">{tr("اختر نموذجًا", "Select a model")}</option>
              {models.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={onStart}
            disabled={effectiveStatus !== "connected" || !provider.model}
            className="btn btn-primary text-xs py-2"
          >
            {tr("بدء محادثة", "Start chat")}
          </button>
          <button
            onClick={onExpand}
            className="btn btn-ghost p-2"
            aria-label={
              expanded
                ? tr("إخفاء تفاصيل الاختبار", "Hide diagnostics")
                : tr("عرض تفاصيل الاختبار", "Show diagnostics")
            }
          >
            {expanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
          </button>
          <button
            onClick={onDelete}
            className="btn btn-ghost text-red-400 p-2"
            aria-label={
              isSession
                ? tr("مسح الجلسة", "Clear session")
                : tr("حذف المزود", "Delete provider")
            }
          >
            <Trash2 size={17} />
          </button>
        </div>
      </div>
      {expanded && <DiagnosticPanel diagnostic={diagnostic} />}
    </div>
  );
}

function StatusBadge({ status }: { status: Provider["status"] | "testing" }) {
  const { tr } = usePreferences();
  const label =
    status === "connected"
      ? tr("متصل", "Connected")
      : status === "error"
        ? tr("فشل", "Failed")
        : status === "testing"
          ? tr("جارٍ الاختبار", "Testing")
          : tr("غير مختبر", "Not tested");
  const style =
    status === "connected"
      ? "border-emerald-600 text-emerald-400"
      : status === "error"
        ? "border-red-600 text-red-400"
        : "border-amber-600 text-amber-400";
  return (
    <div className={`provider-badge ${style}`} role="status">
      {status === "connected" ? (
        <CheckCircle size={12} className="inline ml-1" />
      ) : status === "error" ? (
        <XCircle size={12} className="inline ml-1" />
      ) : status === "testing" ? (
        <RefreshCw size={12} className="inline ml-1 animate-spin" />
      ) : null}
      {label}
    </div>
  );
}
function DiagnosticPanel({ diagnostic }: { diagnostic?: ProviderDiagnostic }) {
  const { language, tr } = usePreferences();
  if (!diagnostic)
    return (
      <div className="border-t border-dark-700 p-5 text-sm text-dark-400">
        {tr("لم يتم تنفيذ اختبار فعلي بعد.", "No live test has been run yet.")}
      </div>
    );
  const category = diagnostic.category
    ? categoryLabels[diagnostic.category]?.[language === "ar" ? 0 : 1] ||
      diagnostic.category
    : tr("نجاح فعلي", "Verified successfully");
  return (
    <div className="border-t border-dark-700 p-5 bg-dark-900/30 text-sm">
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <div className="text-dark-500 text-xs">{tr("النتيجة", "Result")}</div>
          <div
            className={diagnostic.success ? "text-emerald-400" : "text-red-400"}
          >
            {diagnostic.message}
          </div>
        </div>
        <div>
          <div className="text-dark-500 text-xs">{tr("الحالة", "Status")}</div>
          <div>{category}</div>
        </div>
        <div>
          <div className="text-dark-500 text-xs">Endpoint</div>
          <div className="font-mono text-xs break-all" dir="ltr">
            {diagnostic.endpoint || "—"}
          </div>
        </div>
        <div>
          <div className="text-dark-500 text-xs">
            {tr("HTTP/الزمن", "HTTP/Latency")}
          </div>
          <div>
            {diagnostic.httpStatus || "—"} • {diagnostic.latencyMs}ms
          </div>
        </div>
      </div>
      {diagnostic.providerMessage && (
        <div className="mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
          <div className="text-xs text-red-300 mb-1">
            {tr(
              "رسالة المزود بعد تنقيح الأسرار",
              "Provider message after secret redaction",
            )}
          </div>
          <div className="text-red-200 break-words">
            {diagnostic.providerMessage}
          </div>
        </div>
      )}
      {diagnostic.hint && (
        <div className="mt-3 p-3 rounded-xl bg-primary-500/10 border border-primary-500/20">
          <span className="font-medium">{tr("التوجيه: ", "Guidance: ")}</span>
          {diagnostic.hint}
        </div>
      )}
      {diagnostic.warning && (
        <div className="mt-3 text-amber-400">{diagnostic.warning}</div>
      )}
      {diagnostic.models.length > 0 && (
        <div className="mt-4">
          <div className="text-xs text-dark-500 mb-1">
            {tr(
              `النماذج المكتشفة (${diagnostic.models.length})`,
              `Discovered models (${diagnostic.models.length})`,
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            {diagnostic.models.slice(0, 50).map((model) => (
              <span
                key={model}
                className="text-xs bg-dark-800 rounded px-2 py-1 font-mono"
                dir="ltr"
              >
                {model}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

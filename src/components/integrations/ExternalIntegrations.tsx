import { useEffect, useState } from "react";
import {
  CheckCircle,
  ExternalLink,
  Github,
  Loader2,
  MessageCircle,
  Power,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { apiJson, authHeaders } from "../../lib/api";
import { usePreferences } from "../../contexts/PreferencesContext";

type ExternalIntegration = {
  id: string;
  kind: "github" | "whatsapp";
  name: string;
  accountId: string;
  accountName?: string;
  config: Record<string, unknown>;
  isEnabled: boolean;
  status: "connected" | "error" | "disabled";
  lastCheckedAt?: string;
  lastErrorMessage?: string;
};

type GitHubRepository = {
  id: string;
  fullName: string;
  private: boolean;
  url: string;
  defaultBranch: string;
};

export default function ExternalIntegrations() {
  const { tr } = usePreferences();
  const [integrations, setIntegrations] = useState<ExternalIntegration[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [tested, setTested] = useState<"github" | "whatsapp" | null>(null);
  const [repositories, setRepositories] = useState<
    Record<string, GitHubRepository[]>
  >({});
  const [github, setGithub] = useState({ name: "GitHub", token: "" });
  const [whatsapp, setWhatsapp] = useState({
    name: "WhatsApp",
    accessToken: "",
    phoneNumberId: "",
    apiVersion: "v25.0",
  });
  const [message, setMessage] = useState({
    integrationId: "",
    recipient: "",
    text: tr(
      "رسالة اختبار من Moataz AI — الاتصال يعمل بنجاح.",
      "Test message from Moataz AI — the connection works.",
    ),
  });

  const load = async () => {
    setLoading(true);
    try {
      const body = await apiJson<{ integrations: ExternalIntegration[] }>(
        "/api/integrations/external",
        { headers: await authHeaders(false) },
      );
      setIntegrations(body.integrations || []);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : tr("تعذر تحميل الاتصالات", "Could not load connections"),
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const testCredentials = async (kind: "github" | "whatsapp") => {
    setBusy(`test:${kind}`);
    try {
      const payload =
        kind === "github"
          ? { kind, token: github.token }
          : {
              kind,
              accessToken: whatsapp.accessToken,
              phoneNumberId: whatsapp.phoneNumberId,
              apiVersion: whatsapp.apiVersion,
            };
      await apiJson("/api/integrations/external/test", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify(payload),
      });
      setTested(kind);
      toast.success(
        kind === "github"
          ? tr("تم التحقق من حساب GitHub", "GitHub account verified")
          : tr("تم التحقق من رقم WhatsApp", "WhatsApp number verified"),
      );
    } catch (error) {
      setTested(null);
      toast.error(
        error instanceof Error
          ? error.message
          : tr("فشل اختبار بيانات الاتصال", "Connection test failed"),
      );
    } finally {
      setBusy(null);
    }
  };

  const create = async (kind: "github" | "whatsapp") => {
    if (tested !== kind) {
      toast.error(
        tr("اختبر بيانات الاتصال أولًا", "Test the connection details first"),
      );
      return;
    }
    setBusy(`create:${kind}`);
    try {
      const payload =
        kind === "github"
          ? { kind, name: github.name, token: github.token }
          : {
              kind,
              name: whatsapp.name,
              accessToken: whatsapp.accessToken,
              phoneNumberId: whatsapp.phoneNumberId,
              apiVersion: whatsapp.apiVersion,
            };
      const body = await apiJson<{ integration: ExternalIntegration }>(
        "/api/integrations/external",
        {
          method: "POST",
          headers: await authHeaders(),
          body: JSON.stringify(payload),
        },
      );
      setIntegrations((current) => [body.integration, ...current]);
      if (kind === "github") setGithub({ name: "GitHub", token: "" });
      else
        setWhatsapp({
          name: "WhatsApp",
          accessToken: "",
          phoneNumberId: "",
          apiVersion: "v25.0",
        });
      setTested(null);
      toast.success(
        tr("تم حفظ بيانات الاتصال بأمان", "Connection details saved securely"),
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : tr("تعذر حفظ الاتصال", "Could not save the connection"),
      );
    } finally {
      setBusy(null);
    }
  };

  const action = async (
    integration: ExternalIntegration,
    actionName: "check" | "repositories" | "set-enabled",
  ) => {
    setBusy(`${actionName}:${integration.id}`);
    try {
      const body = await apiJson<{
        integration?: ExternalIntegration;
        repositories?: GitHubRepository[];
      }>("/api/integrations/external", {
        method: "PATCH",
        headers: await authHeaders(),
        body: JSON.stringify({
          action: actionName,
          integrationId: integration.id,
          ...(actionName === "set-enabled"
            ? { isEnabled: !integration.isEnabled }
            : {}),
        }),
      });
      if (body.integration)
        setIntegrations((current) =>
          current.map((item) =>
            item.id === integration.id ? body.integration! : item,
          ),
        );
      if (body.repositories)
        setRepositories((current) => ({
          ...current,
          [integration.id]: body.repositories!,
        }));
      toast.success(
        actionName === "repositories"
          ? tr(
              `تم تحميل ${body.repositories?.length || 0} مستودع`,
              `${body.repositories?.length || 0} repositories loaded`,
            )
          : actionName === "check"
            ? tr("الاتصال سليم", "Connection is healthy")
            : integration.isEnabled
              ? tr("تم تعطيل الاتصال", "Connection disabled")
              : tr("تم تفعيل الاتصال", "Connection enabled"),
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : tr("فشل تنفيذ العملية", "Operation failed"),
      );
      if (actionName === "check") void load();
    } finally {
      setBusy(null);
    }
  };

  const sendWhatsApp = async (integration: ExternalIntegration) => {
    setBusy(`send:${integration.id}`);
    try {
      await apiJson("/api/integrations/external", {
        method: "PATCH",
        headers: await authHeaders(),
        body: JSON.stringify({
          action: "send-message",
          integrationId: integration.id,
          recipient: message.recipient,
          message: message.text,
        }),
      });
      toast.success(
        tr("تم تسليم الرسالة إلى WhatsApp", "Message delivered to WhatsApp"),
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : tr("تعذر إرسال رسالة الاختبار", "Could not send the test message"),
      );
    } finally {
      setBusy(null);
    }
  };

  const remove = async (integration: ExternalIntegration) => {
    if (
      !confirm(
        tr(`حذف اتصال ${integration.name}؟`, `Delete ${integration.name}?`),
      )
    )
      return;
    setBusy(`delete:${integration.id}`);
    try {
      await apiJson("/api/integrations/external", {
        method: "DELETE",
        headers: await authHeaders(),
        body: JSON.stringify({ id: integration.id }),
      });
      setIntegrations((current) =>
        current.filter((item) => item.id !== integration.id),
      );
      toast.success(
        tr("تم حذف الاتصال وبياناته", "Connection and its credentials deleted"),
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : tr("تعذر حذف الاتصال", "Could not delete the connection"),
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mt-8 space-y-5">
      <div>
        <h2 className="text-2xl font-semibold">
          {tr("اتصالات المنصات", "Platform connections")}
        </h2>
        <p className="text-sm text-dark-400 mt-1 leading-7">
          {tr(
            "اختبر حسابات GitHub وWhatsApp وأدرها من مكان واحد. تُحفظ بيانات الاعتماد بأمان ولا تظهر مرة أخرى.",
            "Verify and manage GitHub and WhatsApp accounts in one place. Credentials are stored securely and are never shown again.",
          )}
        </p>
      </div>

      <div className="grid xl:grid-cols-2 gap-5">
        <details className="card p-5 group" open>
          <summary className="cursor-pointer list-none flex items-center justify-between gap-3">
            <span className="flex items-center gap-3 font-semibold text-lg">
              <Github /> {tr("ربط GitHub", "Connect GitHub")}
            </span>
            <span className="text-xs text-dark-500">Fine-grained token</span>
          </summary>
          <div className="mt-5 space-y-4">
            <p className="text-xs text-dark-400 leading-6">
              {tr(
                "أنشئ توكنًا محدود المستودعات والصلاحيات. للأتمتة طويلة الأجل يُفضل استخدام GitHub App.",
                "Create a token limited to the required repositories and permissions. A GitHub App is preferred for long-running automation.",
              )}
            </p>
            <label className="block text-sm">
              {tr("اسم الاتصال", "Connection name")}
              <input
                className="input mt-1.5"
                value={github.name}
                onChange={(event) => {
                  setGithub({ ...github, name: event.target.value });
                  setTested(null);
                }}
              />
            </label>
            <label className="block text-sm">
              Personal access token
              <input
                type="password"
                autoComplete="new-password"
                dir="ltr"
                className="input mt-1.5 font-mono"
                value={github.token}
                onChange={(event) => {
                  setGithub({ ...github, token: event.target.value });
                  setTested(null);
                }}
                placeholder="github_pat_..."
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                className="btn btn-secondary"
                disabled={!github.token || busy === "test:github"}
                onClick={() => void testCredentials("github")}
              >
                {busy === "test:github" ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <ShieldCheck size={16} />
                )}{" "}
                {tr("اختبار الاتصال", "Test connection")}
              </button>
              <button
                className="btn btn-primary"
                disabled={tested !== "github" || busy === "create:github"}
                onClick={() => void create("github")}
              >
                {busy === "create:github" ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <CheckCircle size={16} />
                )}{" "}
                {tr("حفظ آمن", "Save securely")}
              </button>
            </div>
          </div>
        </details>

        <details className="card p-5 group">
          <summary className="cursor-pointer list-none flex items-center justify-between gap-3">
            <span className="flex items-center gap-3 font-semibold text-lg">
              <MessageCircle className="text-emerald-400" />{" "}
              {tr("ربط WhatsApp", "Connect WhatsApp")}
            </span>
            <span className="text-xs text-dark-500">Cloud API</span>
          </summary>
          <div className="mt-5 space-y-4">
            <p className="text-xs text-dark-400 leading-6">
              {tr(
                "استخدم System User access token وPhone Number ID من Meta. يمكنك التحقق من الرقم وإرسال رسالة اختبار قبل الحفظ.",
                "Use a Meta System User access token and Phone Number ID. Verify the number and send a test message before saving.",
              )}
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block text-sm">
                {tr("اسم الاتصال", "Connection name")}
                <input
                  className="input mt-1.5"
                  value={whatsapp.name}
                  onChange={(event) => {
                    setWhatsapp({ ...whatsapp, name: event.target.value });
                    setTested(null);
                  }}
                />
              </label>
              <label className="block text-sm">
                Phone Number ID
                <input
                  inputMode="numeric"
                  dir="ltr"
                  className="input mt-1.5 font-mono"
                  value={whatsapp.phoneNumberId}
                  onChange={(event) => {
                    setWhatsapp({
                      ...whatsapp,
                      phoneNumberId: event.target.value,
                    });
                    setTested(null);
                  }}
                />
              </label>
            </div>
            <label className="block text-sm">
              System User access token
              <input
                type="password"
                autoComplete="new-password"
                dir="ltr"
                className="input mt-1.5 font-mono"
                value={whatsapp.accessToken}
                onChange={(event) => {
                  setWhatsapp({ ...whatsapp, accessToken: event.target.value });
                  setTested(null);
                }}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                className="btn btn-secondary"
                disabled={
                  !whatsapp.accessToken ||
                  !whatsapp.phoneNumberId ||
                  busy === "test:whatsapp"
                }
                onClick={() => void testCredentials("whatsapp")}
              >
                {busy === "test:whatsapp" ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <ShieldCheck size={16} />
                )}{" "}
                {tr("اختبار الاتصال", "Test connection")}
              </button>
              <button
                className="btn btn-primary"
                disabled={tested !== "whatsapp" || busy === "create:whatsapp"}
                onClick={() => void create("whatsapp")}
              >
                {busy === "create:whatsapp" ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <CheckCircle size={16} />
                )}{" "}
                {tr("حفظ آمن", "Save securely")}
              </button>
            </div>
          </div>
        </details>
      </div>

      {loading ? (
        <div className="card p-10 text-center text-dark-400">
          <Loader2 className="animate-spin mx-auto mb-3" />
          {tr("جارٍ تحميل الاتصالات...", "Loading connections...")}
        </div>
      ) : integrations.length === 0 ? (
        <div className="card p-8 text-center text-dark-400">
          {tr(
            "لا توجد اتصالات GitHub أو WhatsApp محفوظة بعد.",
            "No saved GitHub or WhatsApp connections yet.",
          )}
        </div>
      ) : (
        <div className="grid xl:grid-cols-2 gap-5">
          {integrations.map((integration) => (
            <article key={integration.id} className="card p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  {integration.kind === "github" ? (
                    <Github />
                  ) : (
                    <MessageCircle className="text-emerald-400" />
                  )}
                  <div>
                    <h3 className="font-semibold">{integration.name}</h3>
                    <p className="text-xs text-dark-500" dir="ltr">
                      {integration.accountName || integration.accountId}
                    </p>
                  </div>
                </div>
                <span
                  className={`provider-badge ${integration.status === "connected" ? "text-emerald-400 border-emerald-700" : integration.status === "error" ? "text-red-400 border-red-700" : "text-amber-400 border-amber-700"}`}
                >
                  {integration.status === "connected"
                    ? tr("متصل", "Connected")
                    : integration.status === "error"
                      ? tr("خطأ", "Error")
                      : tr("معطل", "Disabled")}
                </span>
              </div>
              {integration.lastErrorMessage && (
                <p className="mt-3 p-3 rounded-xl bg-red-500/10 text-xs text-red-300">
                  {integration.lastErrorMessage}
                </p>
              )}
              <div className="flex flex-wrap gap-2 mt-4">
                <button
                  className="btn btn-secondary text-xs"
                  disabled={busy === `check:${integration.id}`}
                  onClick={() => void action(integration, "check")}
                >
                  <RefreshCw
                    size={14}
                    className={
                      busy === `check:${integration.id}` ? "animate-spin" : ""
                    }
                  />{" "}
                  {tr("فحص", "Check")}
                </button>
                <button
                  className="btn btn-secondary text-xs"
                  onClick={() => void action(integration, "set-enabled")}
                >
                  <Power size={14} />{" "}
                  {integration.isEnabled
                    ? tr("تعطيل", "Disable")
                    : tr("تفعيل", "Enable")}
                </button>
                {integration.kind === "github" && (
                  <button
                    className="btn btn-secondary text-xs"
                    disabled={
                      !integration.isEnabled ||
                      busy === `repositories:${integration.id}`
                    }
                    onClick={() => void action(integration, "repositories")}
                  >
                    <Github size={14} /> {tr("المستودعات", "Repositories")}
                  </button>
                )}
                <button
                  className="btn btn-ghost text-red-400 text-xs"
                  disabled={busy === `delete:${integration.id}`}
                  onClick={() => void remove(integration)}
                >
                  <Trash2 size={14} /> {tr("حذف", "Delete")}
                </button>
              </div>
              {repositories[integration.id] && (
                <div className="mt-4 max-h-52 overflow-auto rounded-xl border border-dark-700 divide-y divide-dark-700">
                  {repositories[integration.id].map((repository) => (
                    <a
                      key={repository.id}
                      href={repository.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between gap-3 p-3 text-sm hover:bg-dark-900"
                    >
                      <span className="truncate" dir="ltr">
                        {repository.fullName}
                      </span>
                      <span className="flex items-center gap-2 text-xs text-dark-500">
                        {repository.private
                          ? tr("خاص", "Private")
                          : tr("عام", "Public")}{" "}
                        <ExternalLink size={12} />
                      </span>
                    </a>
                  ))}
                </div>
              )}
              {integration.kind === "whatsapp" && (
                <div className="mt-4 space-y-3 border-t border-dark-700 pt-4">
                  <label className="block text-xs">
                    {tr(
                      "رقم الاختبار بصيغة دولية",
                      "Test number in international format",
                    )}
                    <input
                      inputMode="tel"
                      dir="ltr"
                      className="input mt-1.5"
                      value={
                        message.integrationId === integration.id
                          ? message.recipient
                          : ""
                      }
                      onChange={(event) =>
                        setMessage({
                          ...message,
                          integrationId: integration.id,
                          recipient: event.target.value,
                        })
                      }
                      placeholder="+967..."
                    />
                  </label>
                  <label className="block text-xs">
                    {tr("الرسالة", "Message")}
                    <textarea
                      className="textarea mt-1.5"
                      value={
                        message.integrationId === integration.id
                          ? message.text
                          : tr(
                              "رسالة اختبار من Moataz AI — الاتصال يعمل بنجاح.",
                              "Test message from Moataz AI — the connection works.",
                            )
                      }
                      onChange={(event) =>
                        setMessage({
                          ...message,
                          integrationId: integration.id,
                          text: event.target.value,
                        })
                      }
                    />
                  </label>
                  <button
                    className="btn btn-primary text-xs"
                    disabled={
                      !integration.isEnabled ||
                      message.integrationId !== integration.id ||
                      !message.recipient ||
                      busy === `send:${integration.id}`
                    }
                    onClick={() => void sendWhatsApp(integration)}
                  >
                    {busy === `send:${integration.id}` ? (
                      <Loader2 className="animate-spin" size={14} />
                    ) : (
                      <Send size={14} />
                    )}{" "}
                    {tr("إرسال رسالة اختبار", "Send test message")}
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

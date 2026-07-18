import { useRef } from "react";
import { Bot, Check, ChevronDown, Cpu } from "lucide-react";
import type { Provider } from "../../types";
import type { SessionProviderCredential } from "../../lib/session-provider";

type ActiveProvider = Provider | SessionProviderCredential;
type PlatformUsage = { requestsUsed: number; requestsLimit: number };

export function ChatProviderControls({
  providers,
  selectedProvider,
  selectedModel,
  platformUsage,
  onProviderChange,
  onModelChange,
  tr,
}: {
  providers: ActiveProvider[];
  selectedProvider: ActiveProvider | null;
  selectedModel: string;
  platformUsage: PlatformUsage | null;
  onProviderChange: (provider: ActiveProvider) => Promise<void> | void;
  onModelChange: (model: string) => Promise<void> | void;
  tr: (arabic: string, english: string) => string;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const models = Array.from(new Set([selectedModel, ...(selectedProvider?.models || []), selectedProvider?.model || ""].filter(Boolean)));

  return (
    <div className="chat-provider-controls" aria-label={tr("إعدادات النموذج", "Model settings")}>
      <details ref={detailsRef} className="chat-provider-picker">
        <summary>
          <span className="chat-control-icon"><Bot size={16} /></span>
          <span className="chat-control-copy">
            <small>{tr("المزود", "Provider")}</small>
            <strong>{selectedProvider?.name || tr("اختر مزودًا", "Select provider")}</strong>
          </span>
          <ChevronDown size={15} />
        </summary>
        <div className="chat-provider-menu" role="listbox" aria-label={tr("المزودون المتاحون", "Available providers")}>
          {providers.map((provider) => (
            <button
              type="button"
              role="option"
              aria-selected={selectedProvider?.id === provider.id}
              key={provider.id}
              onClick={() => {
                detailsRef.current?.removeAttribute("open");
                void onProviderChange(provider);
              }}
            >
              <span className="chat-provider-menu-copy">
                <strong>{provider.name}</strong>
                <small>
                  {provider.id === "session"
                    ? tr("جلسة خاصة", "Private session")
                    : provider.credentialMode === "platform" && platformUsage
                      ? tr(`${platformUsage.requestsUsed}/${platformUsage.requestsLimit} طلب اليوم`, `${platformUsage.requestsUsed}/${platformUsage.requestsLimit} requests today`)
                      : provider.status === "connected"
                        ? tr("تم اختباره", "Verified")
                        : tr("غير مختبر", "Not verified")}
                </small>
              </span>
              {selectedProvider?.id === provider.id ? <Check size={16} /> : null}
            </button>
          ))}
          {!providers.length ? <p>{tr("لا يوجد مزود متاح", "No provider available")}</p> : null}
        </div>
      </details>

      <label className="chat-model-picker">
        <span className="chat-control-icon"><Cpu size={16} /></span>
        <span className="chat-control-copy">
          <small>{tr("النموذج", "Model")}</small>
          <select
            value={selectedModel}
            onChange={(event) => void onModelChange(event.target.value)}
            disabled={!selectedProvider || !models.length}
            aria-label={tr("اختيار النموذج", "Select model")}
            dir="ltr"
          >
            {!models.length ? <option value="">{tr("لا يوجد نموذج", "No model")}</option> : null}
            {models.map((model) => <option key={model} value={model}>{model}</option>)}
          </select>
        </span>
        <ChevronDown size={15} />
      </label>
    </div>
  );
}

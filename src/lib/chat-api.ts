import type { ProviderProtocol } from "../../shared/provider-registry";
import type { CredentialMode } from "../../shared/credential-mode";
import type { ChatAttachment } from "../types";
import type { SessionProviderCredential } from "./session-provider";

export type ChatWireMessage = {
  role: "system" | "user" | "assistant";
  content: string;
  attachments?: ChatAttachment[];
};

export type StreamClientEvent =
  | {
      event: "meta";
      data: {
        model: string;
        provider: string;
        protocol: ProviderProtocol;
        endpoint: string;
      };
    }
  | { event: "delta"; data: { content: string } }
  | {
      event: "usage";
      data: { inputTokens: number; outputTokens: number; totalTokens: number };
    }
  | {
      event: "error";
      data: { code: string; message: string; category: string };
    }
  | { event: "done"; data: Record<string, never> };

interface StreamChatParams {
  credentialMode: CredentialMode;
  providerId?: string;
  sessionProvider?: SessionProviderCredential;
  accessToken?: string;
  model: string;
  messages: ChatWireMessage[];
  signal?: AbortSignal;
  onContent: (content: string) => void;
  onEvent?: (event: StreamClientEvent) => void;
}

function serializeMessages(messages: ChatWireMessage[]) {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
    ...(message.attachments?.length
      ? {
          attachments: message.attachments.map((attachment) =>
            attachment.type === "image"
              ? {
                  type: "image" as const,
                  mimeType: attachment.mimeType,
                  dataUrl: attachment.dataUrl,
                  ...(attachment.name ? { name: attachment.name } : {}),
                  ...(attachment.size !== undefined
                    ? { size: attachment.size }
                    : {}),
                }
              : {
                  type: "text" as const,
                  mimeType: attachment.mimeType,
                  text: attachment.text,
                  ...(attachment.name ? { name: attachment.name } : {}),
                  ...(attachment.size !== undefined
                    ? { size: attachment.size }
                    : {}),
                },
          ),
        }
      : {}),
  }));
}

export class ChatStreamError extends Error {
  constructor(
    message: string,
    public readonly code = "stream_error",
    public readonly category = "unknown",
  ) {
    super(message);
    this.name = "ChatStreamError";
  }
}

function requestBody(params: StreamChatParams) {
  const messages = serializeMessages(params.messages);
  if (params.credentialMode === "saved") {
    if (!params.providerId) throw new Error("providerId مطلوب للمزود المحفوظ");
    return {
      credentialMode: "saved",
      providerId: params.providerId,
      model: params.model,
      messages,
      stream: true,
    };
  }
  if (params.credentialMode === "platform") {
    return {
      credentialMode: "platform",
      messages,
      stream: true,
    };
  }
  const provider = params.sessionProvider;
  if (!provider) throw new Error("لا توجد بيانات مزود مؤقت في هذه الجلسة");
  return {
    credentialMode: "session",
    provider: {
      type: provider.type,
      protocol: provider.protocol,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model: provider.model,
    },
    model: params.model,
    messages,
    stream: true,
  };
}

async function responseError(response: Response) {
  const body = await response.json().catch(() => null);
  const diagnostic =
    body?.details?.diagnostic || body?.diagnostic || body?.details;
  return new ChatStreamError(
    diagnostic?.providerMessage ||
      body?.error ||
      body?.message ||
      `HTTP ${response.status}`,
    diagnostic?.code || body?.code,
    diagnostic?.category,
  );
}

export async function streamChat(params: StreamChatParams): Promise<{
  content: string;
  tokens: number;
  meta?: StreamClientEvent & { event: "meta" };
}> {
  if (params.credentialMode !== "session") {
    // Refresh the access cookie server-side when a long-lived tab crosses the
    // short access-token lifetime. No token is returned to JavaScript.
    await fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" }).catch(() => undefined);
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  // Saved/platform requests authenticate through the HttpOnly cookie. The
  // optional accessToken remains for backwards-compatible previews only.
  if (params.accessToken) headers.Authorization = `Bearer ${params.accessToken}`;
  const response = await fetch("/api/chat", {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody(params)),
    signal: params.signal,
  });
  if (!response.ok || !response.body) throw await responseError(response);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let tokens = 0;
  let meta: (StreamClientEvent & { event: "meta" }) | undefined;
  const abortReader = () => {
    void reader.cancel("aborted by user").catch(() => undefined);
  };
  params.signal?.addEventListener("abort", abortReader, { once: true });

  const processBlock = (block: string) => {
    let eventName = "message";
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      if (line.startsWith("data:"))
        dataLines.push(line.slice(5).replace(/^ /, ""));
    }
    if (!dataLines.length) return false;
    let data: any;
    try {
      data = JSON.parse(dataLines.join("\n"));
    } catch {
      throw new ChatStreamError(
        "أعاد الخادم حدث بث غير صالح",
        "invalid_stream_json",
        "upstream",
      );
    }
    const event = { event: eventName, data } as StreamClientEvent;
    params.onEvent?.(event);
    if (event.event === "meta") meta = event;
    if (event.event === "delta") {
      content += event.data.content;
      params.onContent(content);
    }
    if (event.event === "usage") tokens = event.data.totalTokens;
    if (event.event === "error")
      throw new ChatStreamError(
        event.data.message,
        event.data.code,
        event.data.category,
      );
    return event.event === "done";
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (params.signal?.aborted)
        throw new DOMException("Aborted", "AbortError");
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (processBlock(block)) return { content, tokens, meta };
        boundary = buffer.indexOf("\n\n");
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) processBlock(buffer.trim());
    if (params.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return { content, tokens, meta };
  } finally {
    params.signal?.removeEventListener("abort", abortReader);
    if (params.signal?.aborted)
      await reader.cancel("aborted by user").catch(() => undefined);
    reader.releaseLock();
  }
}

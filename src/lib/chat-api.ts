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
        endpoint?: string;
        requestId?: string;
      };
    }
  | {
      event: "status";
      data: {
        phase: "accepted" | "connecting" | "retrying";
        requestId?: string;
        attempt?: number;
      };
    }
  | { event: "delta"; data: { content: string } }
  | {
      event: "usage";
      data: { inputTokens: number; outputTokens: number; totalTokens: number };
    }
  | {
      event: "error";
      data: { code: string; message: string; category: string; requestId?: string };
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
    public readonly requestId?: string,
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
    response.headers.get("x-request-id") || diagnostic?.requestId || body?.requestId,
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
  let receivedDone = false;
  const requestId = response.headers.get("x-request-id") || undefined;
  const abortReader = () => {
    void reader.cancel("aborted by user").catch(() => undefined);
  };
  params.signal?.addEventListener("abort", abortReader, { once: true });

  const processBlock = (block: string) => {
    let eventName = "message";
    const dataLines: string[] = [];
    for (const line of block.split(/\r\n|\r|\n/)) {
      if (!line || line.startsWith(":")) continue;
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
        event.data.requestId || requestId,
      );
    if (event.event === "done") receivedDone = true;
    return event.event === "done";
  };

  const completeResult = () => {
    if (!receivedDone) {
      throw new ChatStreamError(
        "انقطع البث قبل اكتمال الإجابة",
        "stream_incomplete",
        "network",
        requestId,
      );
    }
    if (!content.trim()) {
      throw new ChatStreamError(
        "اكتمل الطلب دون أن يعيد المزود نصًا",
        "empty_stream_response",
        "upstream",
        requestId,
      );
    }
    return { content, tokens, meta };
  };

  const nextBoundary = (value: string) => {
    const candidates = [
      { index: value.indexOf("\r\n\r\n"), length: 4 },
      { index: value.indexOf("\n\n"), length: 2 },
      { index: value.indexOf("\r\r"), length: 2 },
    ].filter((candidate) => candidate.index >= 0);
    return candidates.sort((left, right) => left.index - right.index)[0];
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (params.signal?.aborted)
        throw new DOMException("Aborted", "AbortError");
      buffer += decoder.decode(value, { stream: true });
      let boundary = nextBoundary(buffer);
      while (boundary) {
        const block = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary.length);
        if (processBlock(block)) return completeResult();
        boundary = nextBoundary(buffer);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) processBlock(buffer.trim());
    if (params.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return completeResult();
  } finally {
    params.signal?.removeEventListener("abort", abortReader);
    if (params.signal?.aborted)
      await reader.cancel("aborted by user").catch(() => undefined);
    reader.releaseLock();
  }
}

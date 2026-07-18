import { createClient, type SupabaseClient, type SupportedStorage } from "@supabase/supabase-js";
import type {
  Chat,
  ChatAttachmentMetadata,
  CredentialMode,
  Message,
  Provider,
} from "../types";
import { resolveProviderProtocol } from "../../shared/provider-registry";
import { CHAT_FILE_MIME_TYPES } from "../../shared/file-contract";
import { apiJson, authHeaders } from "./api";

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_URL) as string | undefined;

function validBrowserKey(value: string | undefined, url: string | undefined) {
  const key = value?.trim();
  if (!key || !url) return false;
  if (/^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(key)) return true;
  const parts = key.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(
      atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, "=")),
    ) as { iss?: string; ref?: string; role?: string };
    const projectRef = new URL(url).hostname.split(".")[0];
    return (
      decoded.iss === "supabase" &&
      decoded.ref === projectRef &&
      decoded.role === "anon"
    );
  } catch {
    return false;
  }
}

// Prefer modern publishable keys across both supported naming conventions.
// Legacy anon JWTs are accepted only when their issuer, role and project ref
// match the configured Supabase URL, preventing a malformed/stale key from
// shadowing a valid publishable key.
const supabaseKey = [
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
].find((key) => validBrowserKey(key, supabaseUrl));

/** Keep access/refresh tokens in memory; only the short-lived PKCE verifier may
 * survive a navigation, and it is kept in sessionStorage rather than localStorage. */
export function createEphemeralAuthStorage(sessionStore?: Storage): SupportedStorage {
  const memory = new Map<string, string>();
  const verifierStore = sessionStore || (typeof window !== "undefined" ? window.sessionStorage : undefined);
  const isVerifier = (key: string) => key.endsWith("-code-verifier");
  return {
    getItem: (key) => isVerifier(key) ? verifierStore?.getItem(key) ?? null : memory.get(key) ?? null,
    setItem: (key, value) => { if (isVerifier(key)) verifierStore?.setItem(key, value); else memory.set(key, value); },
    removeItem: (key) => { if (isVerifier(key)) verifierStore?.removeItem(key); else memory.delete(key); },
  };
}

export const supabase: SupabaseClient | null =
  supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: "pkce",
          storage: createEphemeralAuthStorage(),
        },
      })
    : null;

export function getSupabaseBrowserConfig() {
  return supabaseUrl && supabaseKey
    ? { url: supabaseUrl, publishableKey: supabaseKey }
    : null;
}

export function requireSupabase() {
  if (!supabase) {
    return null;
  }
  return supabase;
}

export function mapProvider(row: any): Provider {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    protocol: resolveProviderProtocol(row.type, row.protocol, row.base_url),
    credentialMode: "saved",
    baseUrl: row.base_url || undefined,
    model: row.model || undefined,
    isEnabled: row.is_enabled !== false,
    lastTested: row.last_tested_at || undefined,
    status: row.status || "untested",
    errorMessage: row.error_message || undefined,
    models: Array.isArray(row.models) ? row.models : [],
  };
}

export function mapChat(row: any): Chat {
  return {
    id: row.id,
    title: row.title,
    providerId: row.provider_id || "",
    credentialMode: row.credential_mode === "platform" ? "platform" : "saved",
    model: row.model || "",
    mode: row.mode === "agent" ? "agent" : "chat",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: row.message_count || 0,
  };
}

const attachmentMimeTypes = new Set<string>(CHAT_FILE_MIME_TYPES);

function mapAttachmentMetadata(
  value: unknown,
): ChatAttachmentMetadata[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const attachments = value.flatMap((item): ChatAttachmentMetadata[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (
      (row.type !== "image" && row.type !== "text") ||
      typeof row.mimeType !== "string" ||
      !attachmentMimeTypes.has(row.mimeType)
    )
      return [];
    return [
      {
        type: row.type,
        mimeType: row.mimeType as ChatAttachmentMetadata["mimeType"],
        ...(typeof row.name === "string" ? { name: row.name } : {}),
        ...(typeof row.size === "number" && Number.isFinite(row.size)
          ? { size: row.size }
          : {}),
        ...(typeof row.fileId === "string" ? { fileId: row.fileId } : {}),
        ...(typeof row.downloadUrl === "string" && row.downloadUrl.startsWith("/api/files/") ? { downloadUrl: row.downloadUrl } : {}),
      },
    ];
  });
  return attachments.length ? attachments : undefined;
}

export function mapMessage(row: any): Message {
  return {
    id: row.id,
    chatId: row.chat_id,
    role: row.role,
    content: row.content,
    attachments: mapAttachmentMetadata(row.attachments),
    createdAt: row.created_at,
    model: row.model || undefined,
    tokens: row.tokens || undefined,
  };
}

export async function listChats(userId: string) {
  void userId;
  const body = await apiJson<{ chats: Chat[] }>("/api/chats", { headers: await authHeaders(false) });
  return body.chats || [];
}

export async function createChat(
  userId: string,
  providerId: string | null,
  model: string,
  mode: "chat" | "agent",
  credentialMode: Exclude<CredentialMode, "session"> = "saved",
) {
  void userId;
  const body = await apiJson<{ chat: Chat }>("/api/chats", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ providerId, model, mode, credentialMode }),
  });
  return body.chat;
}

export async function updateChat(
  chatId: string,
  userId: string,
  patch: Partial<{
    title: string;
    provider_id: string | null;
    credential_mode: Exclude<CredentialMode, "session">;
    model: string;
    mode: "chat" | "agent";
    message_count: number;
  }>,
) {
  void userId;
  const body = await apiJson<{ chat: Chat }>(`/api/chats/${encodeURIComponent(chatId)}`, {
    method: "PATCH",
    headers: await authHeaders(),
    body: JSON.stringify(patch),
  });
  return body.chat;
}

export async function deleteChat(chatId: string, userId: string) {
  void userId;
  await apiJson(`/api/chats/${encodeURIComponent(chatId)}`, { method: "DELETE", headers: await authHeaders(false) });
}

export async function listMessages(chatId: string, userId: string) {
  void userId;
  const body = await apiJson<{ messages: Message[] }>(`/api/chats/${encodeURIComponent(chatId)}/messages`, { headers: await authHeaders(false) });
  return body.messages || [];
}

export async function insertMessage(message: Message, userId: string) {
  void userId;
  const body = await apiJson<{ message: Message }>(`/api/chats/${encodeURIComponent(message.chatId)}/messages`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(message),
  });
  return body.message;
}

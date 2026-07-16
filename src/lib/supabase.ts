import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  Chat,
  ChatAttachmentMetadata,
  CredentialMode,
  Message,
  Provider,
} from "../types";
import { resolveProviderProtocol } from "../../shared/provider-registry";

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

export const supabase: SupabaseClient | null =
  supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: "pkce",
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

const attachmentMimeTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "text/markdown",
  "application/json",
]);

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
  const client = requireSupabase();
  if (!client) return [];
  try {
    const { data, error } = await client
      .from("chats")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return (data || []).map(mapChat);
  } catch {
    return [];
  }
}

export async function createChat(
  userId: string,
  providerId: string | null,
  model: string,
  mode: "chat" | "agent",
  credentialMode: Exclude<CredentialMode, "session"> = "saved",
) {
  const client = requireSupabase();
  if (!client) throw new Error("لا يمكن إنشاء محادثة بدون قاعدة بيانات");
  const { data, error } = await client
    .from("chats")
    .insert({
      user_id: userId,
      provider_id: credentialMode === "platform" ? null : providerId || null,
      credential_mode: credentialMode,
      model,
      mode,
      title: "محادثة جديدة",
    })
    .select("*")
    .single();
  if (error) throw error;
  return mapChat(data);
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
  const client = requireSupabase();
  if (!client) return null;
  const { data, error } = await client
    .from("chats")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", chatId)
    .eq("user_id", userId)
    .select("*")
    .single();
  if (error) throw error;
  return mapChat(data);
}

export async function deleteChat(chatId: string, userId: string) {
  const client = requireSupabase();
  if (!client) return;
  const { error } = await client
    .from("chats")
    .delete()
    .eq("id", chatId)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function listMessages(chatId: string, userId: string) {
  const client = requireSupabase();
  if (!client) return [];
  try {
    const { data, error } = await client
      .from("messages")
      .select("*")
      .eq("chat_id", chatId)
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data || []).map(mapMessage);
  } catch {
    return [];
  }
}

export async function insertMessage(message: Message, userId: string) {
  const client = requireSupabase();
  if (!client)
    return mapMessage({ ...message, created_at: new Date().toISOString() });
  const { data, error } = await client
    .from("messages")
    .insert({
      id: message.id,
      chat_id: message.chatId,
      user_id: userId,
      role: message.role,
      content: message.content,
      attachments:
        message.attachments?.map(({ type, mimeType, name, size }) => ({
          type,
          mimeType,
          ...(name ? { name } : {}),
          ...(size !== undefined ? { size } : {}),
        })) || null,
      model: message.model || null,
      tokens: message.tokens || null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return mapMessage(data);
}

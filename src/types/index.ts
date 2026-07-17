import type {
  ProviderProtocol,
  ProviderType,
} from "../../shared/provider-registry";
import type { CredentialMode } from "../../shared/credential-mode";
import type { UserPreferences } from "../../shared/user-preferences";

export type { CredentialMode, ProviderProtocol, ProviderType };
export type AppRole = "owner" | "admin" | "manager" | "editor" | "user";

export interface User {
  id: string;
  name: string;
  username?: string | null;
  email: string;
  loginEmail?: string;
  avatar?: string;
  role: AppRole;
  roles?: AppRole[];
  isActive: boolean;
  forcePasswordChange?: boolean;
  preferences: UserPreferences;
  createdAt: string;
}

export interface ProviderDiagnostic {
  success: boolean;
  message: string;
  providerMessage?: string;
  category?:
    | "authentication"
    | "authorization"
    | "rate_limit"
    | "quota"
    | "model"
    | "endpoint"
    | "validation"
    | "network"
    | "timeout"
    | "upstream"
    | "unknown";
  code?: string;
  httpStatus?: number;
  endpoint?: string;
  requestId?: string;
  hint?: string;
  detectedProtocol: ProviderProtocol;
  models: string[];
  latencyMs: number;
  testedModel?: string;
  warning?: string;
}

export interface Provider {
  id: string;
  name: string;
  type: ProviderType;
  protocol: ProviderProtocol;
  credentialMode?: Exclude<CredentialMode, "session">;
  baseUrl?: string;
  model?: string;
  isEnabled: boolean;
  lastTested?: string;
  status: "connected" | "error" | "untested";
  errorMessage?: string;
  models?: string[];
  detectedProtocol?: string;
  diagnostic?: ProviderDiagnostic;
  lastLatencyMs?: number;
  lastHttpStatus?: number;
  isPlatformShared?: boolean;
  isPlatformDefault?: boolean;
  platformDailyRequestLimit?: number;
  platformDailyTokenLimit?: number;
}

export interface AdminUser {
  id: string;
  username?: string | null;
  name: string;
  email: string;
  loginEmail?: string;
  role: AppRole;
  isActive: boolean;
  mustChangePassword: boolean;
  isInternalEmail: boolean;
  lastLoginAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Chat {
  id: string;
  title: string;
  providerId: string;
  providerType?: string;
  credentialMode: CredentialMode;
  model: string;
  mode: "chat" | "agent";
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  projectId?: string;
}

export interface Message {
  id: string;
  chatId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  attachments?: ChatMessageAttachment[];
  createdAt: string;
  model?: string;
  tokens?: number;
  toolCalls?: ToolCall[];
  isStreaming?: boolean;
}

export type ChatAttachmentMimeType =
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "text/plain"
  | "text/markdown"
  | "application/json"
  | "text/csv"
  | "text/tab-separated-values"
  | "application/xml"
  | "text/xml"
  | "application/yaml"
  | "text/yaml"
  | "application/x-yaml"
  | "application/sql"
  | "text/javascript"
  | "application/javascript"
  | "text/typescript"
  | "application/typescript"
  | "text/x-python"
  | "text/html"
  | "text/css"
  | "text/x-shellscript";

export type ChatTextAttachmentMimeType = Exclude<
  ChatAttachmentMimeType,
  "image/png" | "image/jpeg" | "image/webp"
>;

export type ChatAttachment =
  | {
      type: "image";
      mimeType: Extract<ChatAttachmentMimeType, `image/${string}`>;
      dataUrl: string;
      name?: string;
      size?: number;
    }
  | {
      type: "text";
      mimeType: ChatTextAttachmentMimeType;
      text: string;
      name?: string;
      size?: number;
    };

export type ChatAttachmentMetadata = {
  type: "image" | "text";
  mimeType: ChatAttachmentMimeType;
  name?: string;
  size?: number;
};

export type ChatMessageAttachment = ChatAttachment | ChatAttachmentMetadata;

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: string;
  status: "pending" | "success" | "error";
}

export interface AgentStep {
  id: string;
  step: number;
  title: string;
  description: string;
  status: "pending" | "running" | "completed" | "error";
  toolName?: string;
  result?: string;
  duration?: number;
}

export interface Integration {
  id: string;
  type: "github" | "telegram" | "mcp";
  name: string;
  connected: boolean;
  config: Record<string, unknown>;
  lastSync?: string;
  status: string;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  chatCount: number;
}

export type ArticleStatus = "draft" | "published" | "archived";

export interface ContentSection {
  id: string;
  slug: string;
  nameAr: string;
  nameEn?: string;
  descriptionAr?: string;
  descriptionEn?: string;
  sortOrder: number;
  isVisible: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Article {
  id: string;
  sectionId?: string;
  section?: Pick<ContentSection, "slug" | "nameAr" | "nameEn">;
  slug: string;
  titleAr: string;
  titleEn?: string;
  excerptAr?: string;
  excerptEn?: string;
  contentAr: string;
  contentEn?: string;
  coverUrl?: string;
  status: ArticleStatus;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Announcement {
  id: string;
  textAr: string;
  textEn?: string;
  href?: string;
  placement: "top" | "dashboard";
  isActive: boolean;
  startsAt?: string;
  endsAt?: string;
  sortOrder: number;
  createdAt: string;
}
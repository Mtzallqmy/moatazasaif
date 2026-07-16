export type TelegramChat = {
  id: string;
  telegramChatId: string;
  telegramUserId?: string;
  chatType?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  isAllowed: boolean;
  linkedAt: string;
  lastMessageAt?: string;
};

export type TelegramIntegration = {
  id: string;
  name: string;
  botId: string;
  botUsername?: string;
  botFirstName?: string;
  providerId: string;
  model: string;
  status: "registering" | "connected" | "error" | "disabled";
  isEnabled: boolean;
  webhookUrl?: string;
  pendingUpdateCount?: number;
  lastErrorMessage?: string;
  lastWebhookCheckedAt?: string;
  lastUpdateAt?: string;
  chats: TelegramChat[];
};

export type TelegramDiagnostic = {
  overall: "healthy" | "degraded" | "offline";
  tokenValid: boolean;
  bot?: { id: string; username?: string; firstName: string };
  webhook: {
    configured: boolean;
    matchesExpected: boolean;
    pendingUpdateCount: number;
    lastErrorMessage?: string;
    lastErrorAt?: string;
  };
  providerValid: boolean;
  model: string;
  linkedChats: number;
  allowedChats: number;
  lastUpdateAt?: string;
  activity: {
    received24h: number;
    processed24h: number;
    failed24h: number;
    lastReceivedAt?: string;
    lastProcessedAt?: string;
  };
  checks: Array<{
    key: string;
    ok: boolean;
    labelAr: string;
    labelEn: string;
    detailAr: string;
    detailEn: string;
  }>;
  recommendations: string[];
};

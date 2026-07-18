import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowDown,
  Bot,
  CircleAlert,
  Eraser,
  History,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../contexts/AuthContext";
import { usePreferences } from "../contexts/PreferencesContext";
import type {
  Chat as ChatType,
  ChatAttachment,
  ChatAttachmentMimeType,
  Message,
  Provider,
} from "../types";
import {
  createChat,
  deleteChat as deleteChatRecord,
  insertMessage,
  listChats,
  listMessages,
  updateChat,
} from "../lib/supabase";
import { apiJson, authHeaders } from "../lib/api";
import { generateId } from "../lib/utils";
import { ChatStreamError, streamChat, type StreamClientEvent } from "../lib/chat-api";
import {
  clearSessionData,
  getSessionProvider,
  type SessionProviderCredential,
} from "../lib/session-provider";
import {
  createLocalChat,
  deleteLocalChat,
  getLocalChat,
  insertLocalMessage,
  listLocalChats,
  listLocalMessages,
  updateLocalChat,
} from "../lib/local-chat-store";
import { deleteChatFile, uploadChatAttachments } from "../lib/files-api";
import AiMessageContent from "../components/chat/AiMessageContent";
import type { CodeArtifact } from "../lib/code-artifacts";
import { createProject, importProjectArtifacts } from "../lib/projects-api";
import { ChatComposer } from "../components/chat/ChatComposer";
import { ChatMessage } from "../components/chat/ChatMessage";
import { ChatProviderControls } from "../components/chat/ChatProviderControls";
import {
  CHAT_FILE_MIME_TYPES,
  MAX_CHAT_FILE_BYTES,
  MAX_CHAT_FILES_PER_MESSAGE,
  fileMimeType,
} from "../../shared/file-contract";

type ActiveProvider = Provider | SessionProviderCredential;

const MAX_ATTACHMENT_COUNT = MAX_CHAT_FILES_PER_MESSAGE;
const MAX_ATTACHMENT_BYTES = MAX_CHAT_FILE_BYTES;
const ATTACHMENT_ACCEPT =
  ".png,.jpg,.jpeg,.webp,.txt,.md,.markdown,.json,.csv,.tsv,.xml,.yaml,.yml,.sql,.js,.mjs,.cjs,.jsx,.ts,.tsx,.mts,.cts,.py,.html,.htm,.css,.sh,.bash";
const ALLOWED_ATTACHMENT_TYPES = new Set<ChatAttachmentMimeType>(CHAT_FILE_MIME_TYPES);

function attachmentType(file: File): ChatAttachmentMimeType | null {
  const detected = fileMimeType(file.name, file.type);
  return detected && ALLOWED_ATTACHMENT_TYPES.has(detected) ? detected : null;
}

function matchesImageSignature(
  type: ChatAttachmentMimeType,
  bytes: Uint8Array,
) {
  if (type === "image/png") {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return signature.every((byte, index) => bytes[index] === byte);
  }
  if (type === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (type === "image/webp") {
    return (
      String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
    );
  }
  return true;
}

function isImageMime(
  type: ChatAttachmentMimeType,
): type is Extract<ChatAttachmentMimeType, `image/${string}`> {
  return type.startsWith("image/");
}

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("invalid_file_data"));
    reader.onerror = () =>
      reject(reader.error || new Error("file_read_failed"));
    reader.readAsDataURL(file);
  });
}

async function loadSavedProviders(): Promise<Provider[]> {
  const body = await apiJson<{ providers: Provider[] }>("/api/providers", {
    headers: await authHeaders(false),
  });
  return body.providers || [];
}

type PlatformUsage = {
  requestsUsed: number;
  requestsLimit: number;
  tokensUsed: number;
  tokensLimit: number;
  resetAt: string;
};

async function loadPlatformProvider() {
  return apiJson<{ provider: Provider | null; usage: PlatformUsage | null }>(
    "/api/platform-provider",
    { headers: await authHeaders(false) },
  );
}

export default function Chat() {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { language, tr } = usePreferences();
  const [savedChats, setSavedChats] = useState<ChatType[]>([]);
  const [localChats, setLocalChats] = useState<ChatType[]>([]);
  const [currentChat, setCurrentChat] = useState<ChatType | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [platformUsage, setPlatformUsage] = useState<PlatformUsage | null>(
    null,
  );
  const [sessionProvider, setSessionProvider] =
    useState<SessionProviderCredential | null>(() => getSessionProvider());
  const [selectedProvider, setSelectedProvider] =
    useState<ActiveProvider | null>(null);
  const [selectedModel, setSelectedModel] = useState("");
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamStatus, setStreamStatus] = useState<"connecting" | "thinking" | "writing">("connecting");
  const [generationError, setGenerationError] = useState<{
    message: string;
    code?: string;
    category?: string;
    requestId?: string;
    attachments: ChatAttachment[];
  } | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const shouldFollowStreamRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const creatingRef = useRef(false);

  const allChats = useMemo(
    () =>
      [...localChats, ...savedChats].sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      ),
    [localChats, savedChats],
  );
  const availableProviders = useMemo<ActiveProvider[]>(
    () => [
      ...(sessionProvider ? [sessionProvider] : []),
      ...providers.filter((provider) => provider.isEnabled),
    ],
    [sessionProvider, providers],
  );

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const [localRows, savedRows] = await Promise.all([
          listLocalChats().catch(() => []),
          user ? listChats(user.id) : Promise.resolve([]),
        ]);
        const [savedProviders, platformResult] = user
          ? await Promise.all([
              loadSavedProviders(),
              loadPlatformProvider().catch(() => ({
                provider: null,
                usage: null,
              })),
            ])
          : [[], { provider: null, usage: null }];
        if (!mounted) return;
        const platformProvider = platformResult.provider
          ? {
              ...platformResult.provider,
              id: "platform",
              credentialMode: "platform" as const,
            }
          : null;
        const nextProviders = [
          ...(platformProvider ? [platformProvider] : []),
          ...savedProviders,
        ];
        setLocalChats(localRows);
        setSavedChats(savedRows);
        setProviders(nextProviders);
        setPlatformUsage(platformResult.usage);
        setSessionProvider(getSessionProvider());
        const first =
          getSessionProvider() ||
          platformProvider ||
          savedProviders.find(
            (provider) => provider.status === "connected" && provider.isEnabled,
          ) ||
          savedProviders[0] ||
          null;
        setSelectedProvider(first);
        setSelectedModel(first?.model || first?.models?.[0] || "");
      } catch (error) {
        if (mounted)
          toast.error(
            error instanceof Error
              ? error.message
              : tr("تعذر تحميل بيانات الدردشة", "Could not load chat data"),
          );
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load();
    const handler = () => {
      const next = getSessionProvider();
      setSessionProvider(next);
      if (next && (!selectedProvider || selectedProvider.id === "session")) {
        setSelectedProvider(next);
        setSelectedModel(next.model || next.models[0] || "");
      }
    };
    window.addEventListener("moataz:session-provider-changed", handler);
    return () => {
      mounted = false;
      window.removeEventListener("moataz:session-provider-changed", handler);
    };
  }, [user]);

  useEffect(() => {
    if (loading || creatingRef.current) return;
    if (!chatId) {
      if (!selectedProvider || !selectedModel) return;
      creatingRef.current = true;
      void createCurrentChat(selectedProvider, selectedModel)
        .then((chat) => navigate(`/chat/${chat.id}`, { replace: true }))
        .catch((error) =>
          toast.error(
            error instanceof Error
              ? error.message
              : tr("تعذر إنشاء المحادثة", "Could not create the chat"),
          ),
        )
        .finally(() => {
          creatingRef.current = false;
        });
      return;
    }
    let cancelled = false;
    const loadChat = async () => {
      let chat = allChats.find((item) => item.id === chatId);
      if (!chat) chat = await getLocalChat(chatId).catch(() => undefined);
      if (!chat || cancelled) return;
      setCurrentChat(chat);
      const rows =
        chat.credentialMode === "session"
          ? await listLocalMessages(chat.id).catch(() => [])
          : user
            ? await listMessages(chat.id, user.id)
            : [];
      if (!cancelled) setMessages(rows);
      const provider =
        chat.credentialMode === "session"
          ? sessionProvider
          : chat.credentialMode === "platform"
            ? providers.find((item) => item.credentialMode === "platform")
            : providers.find((item) => item.id === chat?.providerId);
      if (provider && !cancelled) {
        setSelectedProvider(provider);
        setSelectedModel(
          chat.model || provider.model || provider.models?.[0] || "",
        );
      }
    };
    void loadChat().catch((error) => {
      if (!cancelled)
        toast.error(
          error instanceof Error
            ? error.message
            : tr("تعذر تحميل المحادثة", "Could not load the chat"),
        );
    });
    return () => {
      cancelled = true;
    };
  }, [chatId, loading, allChats, providers, sessionProvider, user]);

  useEffect(() => {
    if (!shouldFollowStreamRef.current) return;
    messagesEndRef.current?.scrollIntoView({
      behavior: streamingContent ? "auto" : "smooth",
      block: "end",
    });
  }, [messages, streamingContent, generationError]);

  async function createCurrentChat(provider: ActiveProvider, model: string) {
    if (provider.id === "session") {
      const chat = await createLocalChat(provider.type, model);
      setLocalChats((current) => [chat, ...current]);
      return chat;
    }
    if (!user)
      throw new Error(
        tr(
          "سجّل الدخول لاستخدام المزود المحفوظ",
          "Sign in to use a saved provider",
        ),
      );
    const credentialMode =
      provider.credentialMode === "platform" ? "platform" : "saved";
    const chat = await createChat(
      user.id,
      credentialMode === "platform" ? null : provider.id,
      model,
      "chat",
      credentialMode,
    );
    setSavedChats((current) => [chat, ...current]);
    return chat;
  }

  const selectProvider = async (provider: ActiveProvider) => {
    const model = provider.model || provider.models?.[0] || "";
    const credentialMode =
      provider.id === "session"
        ? "session"
        : provider.credentialMode === "platform"
          ? "platform"
          : "saved";
    setSelectedProvider(provider);
    setSelectedModel(model);
    setGenerationError(null);
    if (
      currentChat &&
      (currentChat.credentialMode !== credentialMode ||
        (credentialMode === "saved" && currentChat.providerId !== provider.id))
    ) {
      try {
        const chat = await createCurrentChat(provider, model);
        navigate(`/chat/${chat.id}`);
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : tr(
                "تعذر بدء محادثة بهذا المزود",
                "Could not start a chat with this provider",
              ),
        );
      }
    }
  };

  const selectModel = async (model: string) => {
    if (!model || model === selectedModel) return;
    setSelectedModel(model);
    setGenerationError(null);
    if (!currentChat) return;

    try {
      let updated: ChatType | null = null;
      if (currentChat.credentialMode === "session") {
        updated = await updateLocalChat(currentChat.id, { model });
        setLocalChats((current) =>
          current.map((chat) => (chat.id === updated?.id ? updated : chat)),
        );
      } else if (user) {
        updated = await updateChat(currentChat.id, user.id, { model });
        setSavedChats((current) =>
          current.map((chat) => (chat.id === updated?.id ? updated : chat)),
        );
      }
      if (updated) setCurrentChat(updated);
    } catch (error) {
      setSelectedModel(currentChat.model);
      toast.error(
        error instanceof Error
          ? error.message
          : tr("تعذر تغيير النموذج", "Could not change the model"),
      );
    }
  };

  const createNewChat = async () => {
    if (!selectedProvider || !selectedModel) {
      toast.error(
        tr(
          "اختبر مزودًا واختر نموذجًا أولًا",
          "Verify a provider and select a model first",
        ),
      );
      navigate("/providers");
      return;
    }
    try {
      const chat = await createCurrentChat(selectedProvider, selectedModel);
      navigate(`/chat/${chat.id}`);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : tr("تعذر إنشاء المحادثة", "Could not create the chat"),
      );
    }
  };

  const removeChat = async (id: string) => {
    const target = allChats.find((chat) => chat.id === id);
    try {
      if (target?.credentialMode === "session") {
        await deleteLocalChat(id);
        setLocalChats((current) => current.filter((chat) => chat.id !== id));
      } else if (user) {
        await deleteChatRecord(id, user.id);
        setSavedChats((current) => current.filter((chat) => chat.id !== id));
      }
      if (currentChat?.id === id) navigate("/chat");
      toast.success(tr("تم حذف المحادثة", "Chat deleted"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : tr("تعذر حذف المحادثة", "Could not delete the chat"),
      );
    }
  };

  const requestAssistant = async (
    conversation: Message[],
    inlineAttachments: ChatAttachment[],
    credentialMode: ChatType["credentialMode"],
    chatRecord: ChatType = currentChat as ChatType,
  ) => {
    if (!chatRecord || !selectedProvider) throw new Error("chat_not_ready");
    const isSession = credentialMode === "session";
    const controller = new AbortController();
    abortRef.current = controller;
    setStreamStatus("connecting");
    const result = await streamChat({
      credentialMode,
      providerId: credentialMode === "saved" ? selectedProvider.id : undefined,
      sessionProvider: isSession ? sessionProvider || undefined : undefined,
      model: selectedModel,
      messages: conversation.map((message, index) => ({
        role: message.role === "tool" ? "assistant" : message.role,
        content: message.content,
        ...(index === conversation.length - 1 && inlineAttachments.length
          ? { attachments: inlineAttachments }
          : {}),
      })),
      signal: controller.signal,
      onContent: (content) => {
        setStreamStatus("writing");
        setStreamingContent(content);
      },
      onEvent: (event: StreamClientEvent) => {
        if (event.event === "status" || event.event === "meta") {
          setStreamStatus("thinking");
        }
      },
    });
    const assistant: Message = {
      id: generateId(),
      chatId: chatRecord.id,
      role: "assistant",
      content: result.content,
      createdAt: new Date().toISOString(),
      model: result.meta?.data.model || selectedModel,
      tokens: result.tokens,
    };
    if (isSession) await insertLocalMessage(assistant);
    else if (user) await insertMessage(assistant, user.id);

    const completeConversation = [...conversation, assistant];
    setMessages(completeConversation);
    setStreamingContent("");
    let updatedChat = chatRecord;
    if (isSession) {
      updatedChat = await updateLocalChat(chatRecord.id, {
        messageCount: completeConversation.length,
      });
      setLocalChats((current) =>
        current.map((chat) => (chat.id === updatedChat.id ? updatedChat : chat)),
      );
    } else if (user) {
      updatedChat =
        (await updateChat(chatRecord.id, user.id, {
          message_count: completeConversation.length,
        })) || chatRecord;
      setSavedChats((current) =>
        current.map((chat) => (chat.id === updatedChat.id ? updatedChat : chat)),
      );
    }
    setCurrentChat(updatedChat);
    setGenerationError(null);
    if (credentialMode === "platform") {
      void loadPlatformProvider()
        .then((result) => setPlatformUsage(result.usage))
        .catch(() => undefined);
    }
  };

  const streamFailure = (error: unknown, inlineAttachments: ChatAttachment[]) => {
    const fallback = tr("فشل استدعاء النموذج", "Model request failed");
    const details = error instanceof ChatStreamError ? error : null;
    setGenerationError({
      message: error instanceof Error ? error.message : fallback,
      code: details?.code,
      category: details?.category,
      requestId: details?.requestId,
      attachments: inlineAttachments,
    });
  };

  const sendMessage = async () => {
    if (
      !currentChat ||
      !selectedProvider ||
      !selectedModel ||
      (!input.trim() && attachments.length === 0) ||
      isStreaming
    ) {
      if (!selectedProvider)
        toast.error(
          tr(
            "أضف مزودًا واختبر الاتصال أولًا",
            "Add a provider and verify its connection first",
          ),
        );
      else if (!selectedModel)
        toast.error(
          tr("اختر نموذجًا للمزود", "Select a model for the provider"),
        );
      return;
    }
    const credentialMode =
      selectedProvider.id === "session"
        ? "session"
        : selectedProvider.credentialMode === "platform"
          ? "platform"
          : "saved";
    if (credentialMode !== "session" && !user) {
      toast.error(
        tr(
          "سجّل الدخول لاستخدام المزود المحفوظ",
          "Sign in to use a saved provider",
        ),
      );
      return;
    }
    const content =
      input.trim() || tr("حلّل المرفقات", "Review the attached files");
    const submittedAttachments = attachments;
    setIsStreaming(true);
    setStreamingContent("");
    setGenerationError(null);
    shouldFollowStreamRef.current = true;
    const isSession = credentialMode === "session";
    const messageId = generateId();
    let uploadedFileIds: string[] = [];
    let messageSaved = false;
    try {
      let persistedAttachments: Message["attachments"] = submittedAttachments;
      if (!isSession && submittedAttachments.length) {
        try {
          persistedAttachments = await uploadChatAttachments(currentChat.id, messageId, submittedAttachments);
        } catch {
          // Keep the pre-storage behavior available while a deployment is
          // waiting for its database migration or storage is temporarily down.
          // The provider still receives the verified inline files and the
          // message API persists metadata only; no raw file is written to DB.
          toast.warning(tr(
            "تعذر الحفظ الدائم للمرفق؛ سيُحلّل في هذه الرسالة دون تخزينه.",
            "Permanent attachment storage is unavailable; it will still be analyzed without being stored.",
          ));
        }
      }
      uploadedFileIds = persistedAttachments.flatMap((attachment) => "fileId" in attachment && attachment.fileId ? [attachment.fileId] : []);
      const userMessage: Message = {
        id: messageId,
        chatId: currentChat.id,
        role: "user",
        content,
        attachments: persistedAttachments.length ? persistedAttachments : undefined,
        createdAt: new Date().toISOString(),
      };
      const nextMessages = [...messages, userMessage];
      setInput("");
      setAttachments([]);
      setMessages(nextMessages);
      if (isSession) await insertLocalMessage(userMessage);
      else if (user) await insertMessage(userMessage, user.id);
      messageSaved = true;
      let chat = currentChat;
      if (messages.length === 0) {
        if (isSession)
          chat = await updateLocalChat(currentChat.id, {
            title: content.slice(0, 45),
            model: selectedModel,
          });
        else if (user)
          chat =
            (await updateChat(currentChat.id, user.id, {
              title: content.slice(0, 45),
              provider_id:
                credentialMode === "platform" ? null : selectedProvider.id,
              credential_mode: credentialMode,
              model: selectedModel,
            })) || currentChat;
        setCurrentChat(chat);
        if (isSession)
          setLocalChats((prev) =>
            prev.map((item) => (item.id === chat.id ? chat : item)),
          );
        else
          setSavedChats((prev) =>
            prev.map((item) => (item.id === chat.id ? chat : item)),
          );
      }
      await requestAssistant(nextMessages, submittedAttachments, credentialMode, chat);
    } catch (error) {
      if (!messageSaved && uploadedFileIds.length) {
        await Promise.allSettled(uploadedFileIds.map((fileId) => deleteChatFile(fileId)));
      }
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        if (messageSaved) streamFailure(error, submittedAttachments);
        toast.error(
          error instanceof Error
            ? error.message
            : tr("فشل استدعاء النموذج", "Model request failed"),
        );
      }
    } finally {
      abortRef.current = null;
      setIsStreaming(false);
      setStreamingContent("");
    }
  };

  const retryGeneration = async () => {
    if (!generationError || !currentChat || !selectedProvider || !messages.length || isStreaming) return;
    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role !== "user") return;
    const credentialMode =
      selectedProvider.id === "session"
        ? "session"
        : selectedProvider.credentialMode === "platform"
          ? "platform"
          : "saved";
    setIsStreaming(true);
    setStreamingContent("");
    setGenerationError(null);
    shouldFollowStreamRef.current = true;
    try {
      await requestAssistant(messages, generationError.attachments, credentialMode, currentChat);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        streamFailure(error, generationError.attachments);
        toast.error(error instanceof Error ? error.message : tr("فشل إعادة المحاولة", "Retry failed"));
      }
    } finally {
      abortRef.current = null;
      setIsStreaming(false);
      setStreamingContent("");
    }
  };

  const stopGeneration = () => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setStreamingContent("");
    toast.info(tr("تم إيقاف التوليد", "Generation stopped"));
  };
  const clearSession = async () => {
    try {
      await clearSessionData();
      setSessionProvider(null);
      setLocalChats([]);
      setAttachments([]);
      if (currentChat?.credentialMode === "session") navigate("/chat");
      toast.success(
        tr("تم مسح المفتاح والمحادثات المحلية", "Key and local chats cleared"),
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : tr("تعذر مسح بيانات الجلسة", "Could not clear session data"),
      );
    }
  };

  const saveArtifactsAsProject = async (artifacts: CodeArtifact[]) => {
    if (!user) {
      toast.error(tr("سجّل الدخول لحفظ مشروع", "Sign in to save a project"));
      return;
    }
    try {
      const project = await createProject({
        name: (currentChat?.title || tr("مشروع من الدردشة", "Project from chat")).slice(0, 100),
        description: tr("ملفات مستخرجة من إحدى إجابات الدردشة", "Files extracted from a chat response"),
        template: "empty",
      });
      await importProjectArtifacts(project.id, artifacts.map(({ path, content, mimeType }) => ({ path, content, mimeType })));
      toast.success(tr("تم إنشاء المشروع وحفظ الملفات", "Project and files saved"));
      navigate(`/projects/${project.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tr("تعذر حفظ المشروع", "Could not save project"));
    }
  };

  const addAttachments = async (files: File[]) => {
    let next = [...attachments];
    for (const file of files) {
      if (next.length >= MAX_ATTACHMENT_COUNT) {
        toast.error(
          tr(
            `يمكن إرفاق ${MAX_ATTACHMENT_COUNT} ملفات كحد أقصى`,
            `You can attach up to ${MAX_ATTACHMENT_COUNT} files`,
          ),
        );
        break;
      }

      const mimeType = attachmentType(file);
      if (!mimeType) {
        toast.error(
          tr(
            `نوع الملف غير مدعوم: ${file.name}`,
            `Unsupported file type: ${file.name}`,
          ),
        );
        continue;
      }

      const totalBytes = next.reduce(
        (total, item) => total + (item.size || 0),
        0,
      );
      if (totalBytes + file.size > MAX_ATTACHMENT_BYTES) {
        toast.error(
          tr(
            "يجب ألا يتجاوز إجمالي المرفقات 3 MB",
            "Attachments must not exceed 3 MB in total",
          ),
        );
        continue;
      }

      try {
        const safeName = file.name.slice(0, 160);
        if (isImageMime(mimeType)) {
          const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
          if (!matchesImageSignature(mimeType, bytes)) {
            throw new Error("invalid_image_signature");
          }
          next.push({
            type: "image",
            mimeType,
            dataUrl: await readAsDataUrl(file),
            name: safeName,
            size: file.size,
          });
        } else {
          const text = await file.text();
          if (!text.length) throw new Error("empty_text_file");
          const encodedSize = new TextEncoder().encode(text).byteLength;
          if (totalBytes + encodedSize > MAX_ATTACHMENT_BYTES) {
            toast.error(
              tr(
                "يجب ألا يتجاوز إجمالي المرفقات 3 MB",
                "Attachments must not exceed 3 MB in total",
              ),
            );
            continue;
          }
          if (mimeType === "application/json") JSON.parse(text);
          next.push({
            type: "text",
            mimeType,
            text,
            name: safeName,
            size: encodedSize,
          });
        }
      } catch {
        toast.error(
          tr(
            `تعذر قراءة الملف أو التحقق منه: ${file.name}`,
            `Could not read or validate: ${file.name}`,
          ),
        );
      }
    }
    setAttachments(next);
  };

  const filteredChats = allChats.filter((chat) =>
    chat.title.toLowerCase().includes(searchTerm.toLowerCase()),
  );
  const dateFormatter = new Intl.DateTimeFormat(
    language === "ar" ? "ar-SA" : "en-US",
    { month: "short", day: "numeric" },
  );
  const timeFormatter = new Intl.DateTimeFormat(
    language === "ar" ? "ar-SA" : "en-US",
    { hour: "numeric", minute: "2-digit" },
  );
  const onTranscriptScroll = () => {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    const distance = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight;
    const nearBottom = distance < 140;
    shouldFollowStreamRef.current = nearBottom;
    setShowScrollButton(!nearBottom);
  };
  const scrollToLatest = () => {
    shouldFollowStreamRef.current = true;
    setShowScrollButton(false);
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  };
  const streamingLabel =
    streamStatus === "connecting"
      ? tr("جارٍ الاتصال بالمزود…", "Connecting to provider…")
      : streamStatus === "thinking"
        ? tr("تم الاتصال، جارٍ تجهيز الإجابة…", "Connected, preparing the answer…")
        : tr("جارٍ كتابة الإجابة…", "Writing the answer…");

  return (
    <div className="chat-shell app-canvas">
      <aside
        className="chat-history-panel"
        aria-label={tr("قائمة المحادثات", "Chat list")}
      >
        <div className="p-4 border-b border-dark-200 dark:border-dark-700 flex items-center justify-between">
          <div className="font-semibold">{tr("المحادثات", "Chats")}</div>
          <button
            onClick={() => void createNewChat()}
            className="btn btn-secondary px-3 py-1.5 text-xs"
          >
            <Plus size={14} /> {tr("جديدة", "New")}
          </button>
        </div>
        <div className="p-3">
          <div className="relative">
            <Search
              className="absolute start-3 top-3 text-dark-500"
              size={16}
              aria-hidden="true"
            />
            <label htmlFor="chat-search" className="sr-only">
              {tr("البحث في المحادثات", "Search chats")}
            </label>
            <input
              id="chat-search"
              className="input py-2 ps-9 text-sm"
              placeholder={tr("ابحث...", "Search...")}
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 space-y-1">
          {filteredChats.map((chat) => (
            <div
              key={chat.id}
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/chat/${chat.id}`)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  navigate(`/chat/${chat.id}`);
                }
              }}
              className={`group flex items-center justify-between px-4 py-3 rounded-2xl cursor-pointer text-sm ${currentChat?.id === chat.id ? "bg-primary-600 text-white" : "text-dark-700 dark:text-dark-200 hover:bg-dark-100 dark:hover:bg-dark-800"}`}
            >
              <div className="flex-1 min-w-0 pe-2">
                <div className="font-medium truncate">{chat.title}</div>
                <div className="text-[10px] opacity-60 mt-0.5">
                  {chat.credentialMode === "session"
                    ? tr("محلي", "Local")
                    : chat.credentialMode === "platform"
                      ? tr("المنصة", "Platform")
                      : tr("حساب", "Account")}{" "}
                  {"•"} {chat.model || tr("بدون نموذج", "No model")} {"•"}{" "}
                  {dateFormatter.format(new Date(chat.updatedAt))}
                </div>
              </div>
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  void removeChat(chat.id);
                }}
                className="opacity-60 lg:opacity-0 lg:group-hover:opacity-100 group-focus-within:opacity-100 p-1.5"
                aria-label={tr(`حذف ${chat.title}`, `Delete ${chat.title}`)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <div className="p-4 border-t border-dark-200 dark:border-dark-700 text-[10px] text-dark-500 text-center">
          {user
            ? tr(
                `${savedChats.length} محفوظة في الحساب • ${localChats.length} محلية`,
                `${savedChats.length} in your account • ${localChats.length} local`,
              )
            : tr(
                `${localChats.length} محلية على هذا الجهاز`,
                `${localChats.length} local on this device`,
              )}
        </div>
      </aside>
      <section className="chat-workspace">
        <header className="chat-workspace-header">
          <div className="min-w-0">
            <div className="font-semibold text-lg truncate">
              {currentChat?.title || tr("محادثة جديدة", "New chat")}
            </div>
            <div className="text-xs text-dark-500 truncate">
              {selectedProvider?.name || tr("اختر مزودًا", "Select provider")}{" "}
              {"•"} {selectedModel || tr("اختر نموذجًا", "Select model")} {"•"}{" "}
              {selectedProvider?.protocol || "—"}
            </div>
          </div>
          <div className="chat-header-actions">
            <details className="relative lg:hidden">
              <summary
                className="icon-button h-10 w-10 list-none cursor-pointer"
                aria-label={tr("عرض المحادثات", "Show chats")}
              >
                <History size={18} />
              </summary>
              <div className="absolute end-0 mt-2 w-[min(19rem,calc(100vw-1.5rem))] max-h-72 overflow-y-auto bg-white dark:bg-dark-900 border border-dark-200 dark:border-dark-700 rounded-2xl shadow-2xl p-2 z-50">
                <div className="px-2 py-1.5 text-xs font-semibold text-dark-500">
                  {tr("المحادثات الأخيرة", "Recent chats")}
                </div>
                {allChats.length ? (
                  allChats.slice(0, 12).map((chat) => (
                    <button
                      key={chat.id}
                      type="button"
                      onClick={() => navigate(`/chat/${chat.id}`)}
                      className={`w-full text-start rounded-xl px-3 py-2.5 text-sm ${currentChat?.id === chat.id ? "bg-primary-600 text-white" : "hover:bg-dark-100 dark:hover:bg-dark-800"}`}
                    >
                      <span className="block truncate">{chat.title}</span>
                      <span className="block text-[10px] opacity-60 truncate mt-0.5">
                        {chat.model || tr("بدون نموذج", "No model")}
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-4 text-xs text-dark-500 text-center">
                    {tr("لا توجد محادثات بعد", "No chats yet")}
                  </div>
                )}
              </div>
            </details>
            <button
              type="button"
              onClick={() => void createNewChat()}
              className="btn btn-ghost lg:hidden h-10 w-10 p-0"
              aria-label={tr("محادثة جديدة", "New chat")}
            >
              <Plus size={18} />
            </button>
          </div>
          <ChatProviderControls
            providers={availableProviders}
            selectedProvider={selectedProvider}
            selectedModel={selectedModel}
            platformUsage={platformUsage}
            onProviderChange={selectProvider}
            onModelChange={selectModel}
            tr={tr}
          />
        </header>
        {!user && (
          <div className="px-3 sm:px-5 py-2 bg-primary-500/10 border-b border-primary-500/20 text-xs text-primary-700 dark:text-primary-200 flex items-center gap-2">
            <Shield size={14} />{" "}
            {tr(
              "وضع الضيف: المحادثات تبقى محلية على هذا الجهاز.",
              "Guest mode: chats stay locally on this device.",
            )}
          </div>
        )}
        {user && selectedProvider?.id === "session" && (
          <div className="px-3 sm:px-5 py-2 bg-amber-500/10 border-b border-amber-500/20 text-xs text-amber-800 dark:text-amber-200 flex items-center justify-between">
            <span>
              {tr(
                "تستخدم مزود جلسة؛ لا يُحفظ المفتاح أو الرسائل في الحساب.",
                "This session provider's key and messages are not saved to your account.",
              )}
            </span>
            <button onClick={() => void clearSession()} className="underline">
              <Eraser size={12} className="inline" /> {tr("مسح", "Clear")}
            </button>
          </div>
        )}
        {!selectedProvider && (
          <div className="px-3 sm:px-5 py-2 bg-amber-500/10 border-b border-amber-500/20 text-xs text-amber-800 dark:text-amber-200 flex items-center justify-between">
            <span>
              {tr("لم يتم اختيار مزود بعد.", "No provider selected yet.")}
            </span>
            <Link to="/providers" className="underline">
              {tr("إضافة واختبار مزود", "Add and verify a provider")}
            </Link>
          </div>
        )}
        <div className="chat-transcript-shell">
          <div ref={transcriptRef} className="chat-transcript" onScroll={onTranscriptScroll}>
            <div className="chat-transcript-inner">
              {messages.length === 0 && !isStreaming ? (
                <div className="chat-empty-state">
                  <span className="chat-empty-icon"><Bot size={28} /></span>
                  <h2>{tr("مساحة عمل ذكية وواضحة", "A clear AI workspace")}</h2>
                  <p>
                    {selectedProvider
                      ? tr(
                          "ابدأ بسؤال، أو أرفق صورة أو ملفًا نصيًا أو برمجيًا لتحليله.",
                          "Ask a question, or attach an image, text, or code file for analysis.",
                        )
                      : tr(
                          "أضف مزودًا واختبره فعليًا قبل بدء المحادثة.",
                          "Add a provider and verify it before starting a chat.",
                        )}
                  </p>
                  {!selectedProvider ? (
                    <Link to="/providers" className="btn btn-primary">
                      {tr("إضافة واختبار مزود", "Add and verify a provider")}
                    </Link>
                  ) : (
                    <div className="chat-starter-grid">
                      <button type="button" onClick={() => setInput(tr("لخّص لي هذا الموضوع بخطوات واضحة", "Summarize this topic in clear steps"))}>{tr("تلخيص منظم", "Structured summary")}</button>
                      <button type="button" onClick={() => setInput(tr("راجع هذا الكود واقترح تحسينات آمنة", "Review this code and suggest safe improvements"))}>{tr("مراجعة كود", "Code review")}</button>
                    </div>
                  )}
                </div>
              ) : null}

              {messages.map((message) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  selectedModel={selectedModel}
                  timeLabel={timeFormatter.format(new Date(message.createdAt))}
                  canSaveProject={Boolean(user)}
                  onSaveProject={(items) => void saveArtifactsAsProject(items)}
                  tr={tr}
                />
              ))}

              {isStreaming ? (
                <article className="chat-message-row is-assistant" aria-live="polite" aria-busy="true">
                  <div className="chat-message-avatar is-active"><Bot size={17} /></div>
                  <div className="chat-message-body">
                    <header className="chat-message-header">
                      <strong>Moataz AI</strong>
                      <span dir="ltr">{selectedModel}</span>
                      <span className="chat-live-status"><i /> {streamingLabel}</span>
                    </header>
                    <div className="message-bubble assistant-message streaming-message">
                      {streamingContent ? (
                        <AiMessageContent content={streamingContent} streaming />
                      ) : (
                        <div className="chat-thinking-lines" aria-hidden="true"><span /><span /><span /></div>
                      )}
                    </div>
                  </div>
                </article>
              ) : null}

              {generationError && !isStreaming ? (
                <div className="chat-generation-error" role="alert">
                  <CircleAlert size={20} />
                  <div>
                    <strong>{tr("تعذر إكمال الإجابة", "The answer could not be completed")}</strong>
                    <p>{generationError.message}</p>
                    <div className="chat-error-meta">
                      {generationError.code ? <code>{generationError.code}</code> : null}
                      {generationError.requestId ? <span dir="ltr">ID: {generationError.requestId}</span> : null}
                    </div>
                  </div>
                  <button type="button" className="btn btn-secondary" onClick={() => void retryGeneration()}>
                    <RefreshCw size={15} /> {tr("إعادة المحاولة", "Retry")}
                  </button>
                </div>
              ) : null}
              <div ref={messagesEndRef} />
            </div>
          </div>
          {showScrollButton ? (
            <button type="button" className="chat-scroll-latest" onClick={scrollToLatest} aria-label={tr("الانتقال إلى أحدث رسالة", "Jump to latest message")}>
              <ArrowDown size={18} />
            </button>
          ) : null}
        </div>
        <ChatComposer
          value={input}
          attachments={attachments}
          accept={ATTACHMENT_ACCEPT}
          maxFiles={MAX_ATTACHMENT_COUNT}
          maxBytes={MAX_ATTACHMENT_BYTES}
          disabled={!currentChat || !selectedProvider || !selectedModel}
          isStreaming={isStreaming}
          onChange={setInput}
          onFiles={addAttachments}
          onRemoveAttachment={(index) =>
            setAttachments((current) =>
              current.filter((_, itemIndex) => itemIndex !== index),
            )
          }
          onSend={sendMessage}
          onStop={stopGeneration}
          tr={tr}
        />
      </section>
    </div>
  );
}

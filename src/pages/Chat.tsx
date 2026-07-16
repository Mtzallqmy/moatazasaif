import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Bot,
  ChevronDown,
  Eraser,
  FileText,
  History,
  Image as ImageIcon,
  Paperclip,
  Plus,
  Search,
  Send,
  Shield,
  Square,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
import { streamChat } from "../lib/chat-api";
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
import { supabase } from "../lib/supabase";

type ActiveProvider = Provider | SessionProviderCredential;

const MAX_ATTACHMENT_COUNT = 3;
const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;
const ATTACHMENT_ACCEPT =
  "image/png,image/jpeg,image/webp,text/plain,text/markdown,application/json,.txt,.md,.markdown,.json";
const ALLOWED_ATTACHMENT_TYPES = new Set<ChatAttachmentMimeType>([
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "text/markdown",
  "application/json",
]);

function attachmentType(file: File): ChatAttachmentMimeType | null {
  if (ALLOWED_ATTACHMENT_TYPES.has(file.type as ChatAttachmentMimeType)) {
    return file.type as ChatAttachmentMimeType;
  }
  const extension = file.name.toLowerCase().split(".").pop();
  if (extension === "txt") return "text/plain";
  if (extension === "md" || extension === "markdown") return "text/markdown";
  if (extension === "json") return "application/json";
  return null;
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

function formatAttachmentSize(bytes: number) {
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${Math.ceil(bytes / 1024)} KB`
      : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function getAccessToken(tr: (arabic: string, english: string) => string) {
  if (!supabase)
    throw new Error(
      tr(
        "خدمة الحساب غير متاحة مؤقتًا",
        "The account service is temporarily unavailable",
      ),
    );
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session)
    throw new Error(
      tr("انتهت جلسة الدخول", "Your sign-in session has expired"),
    );
  return data.session.access_token;
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
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const creatingRef = useRef(false);
  const dragDepthRef = useRef(0);

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
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [input]);

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
    setInput("");
    setAttachments([]);
    setIsStreaming(true);
    setStreamingContent("");
    const userMessage: Message = {
      id: generateId(),
      chatId: currentChat.id,
      role: "user",
      content,
      attachments: submittedAttachments.length
        ? submittedAttachments
        : undefined,
      createdAt: new Date().toISOString(),
    };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    const isSession = credentialMode === "session";
    try {
      if (isSession) await insertLocalMessage(userMessage);
      else if (user) await insertMessage(userMessage, user.id);
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
      const controller = new AbortController();
      abortRef.current = controller;
      const accessToken = !isSession ? await getAccessToken(tr) : undefined;
      const result = await streamChat({
        credentialMode,
        providerId:
          credentialMode === "saved" ? selectedProvider.id : undefined,
        sessionProvider: isSession ? sessionProvider || undefined : undefined,
        accessToken,
        model: selectedModel,
        messages: nextMessages.map((message, index) => ({
          role: message.role === "tool" ? "assistant" : message.role,
          content: message.content,
          ...(index === nextMessages.length - 1 && submittedAttachments.length
            ? { attachments: submittedAttachments }
            : {}),
        })),
        signal: controller.signal,
        onContent: setStreamingContent,
      });
      const assistant: Message = {
        id: generateId(),
        chatId: currentChat.id,
        role: "assistant",
        content: result.content,
        createdAt: new Date().toISOString(),
        model: selectedModel,
        tokens: result.tokens,
      };
      if (isSession) await insertLocalMessage(assistant);
      else if (user) await insertMessage(assistant, user.id);
      const all = [...nextMessages, assistant];
      setMessages(all);
      setStreamingContent("");
      if (isSession) {
        chat = await updateLocalChat(currentChat.id, {
          messageCount: all.length,
        });
        setLocalChats((prev) =>
          prev.map((item) => (item.id === chat.id ? chat : item)),
        );
      } else if (user) {
        chat =
          (await updateChat(currentChat.id, user.id, {
            message_count: all.length,
          })) || currentChat;
        setSavedChats((prev) =>
          prev.map((item) => (item.id === chat.id ? chat : item)),
        );
      }
      setCurrentChat(chat);
      if (credentialMode === "platform") {
        void loadPlatformProvider()
          .then((result) => setPlatformUsage(result.usage))
          .catch(() => undefined);
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        toast.error(
          error instanceof Error
            ? error.message
            : tr("فشل استدعاء النموذج", "Model request failed"),
        );
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

  const onFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    void addAttachments(files);
  };

  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!event.dataTransfer.types.includes("Files")) return;
    dragDepthRef.current += 1;
    setIsDraggingFiles(true);
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDraggingFiles(false);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDraggingFiles(false);
    void addAttachments(Array.from(event.dataTransfer.files));
  };

  const filteredChats = allChats.filter((chat) =>
    chat.title.toLowerCase().includes(searchTerm.toLowerCase()),
  );
  const dateFormatter = new Intl.DateTimeFormat(
    language === "ar" ? "ar-SA" : "en-US",
    { month: "short", day: "numeric" },
  );
  const attachmentBytes = attachments.reduce(
    (total, attachment) => total + (attachment.size || 0),
    0,
  );

  return (
    <div className="app-canvas flex h-[calc(100dvh-4rem)] min-h-[28rem] overflow-hidden">
      <aside
        className="w-72 border-e border-dark-200 dark:border-dark-700 bg-white dark:bg-dark-900 flex-col hidden lg:flex"
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
      <div className="flex-1 flex flex-col min-w-0">
        <div className="min-h-14 border-b border-dark-200 dark:border-dark-700 px-3 sm:px-5 py-2 flex items-center justify-between bg-white dark:bg-dark-900 flex-shrink-0 gap-2 sm:gap-3">
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
          <div className="flex items-center gap-2">
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
            <div className="hidden sm:flex items-center bg-dark-100 dark:bg-dark-800 rounded-2xl p-1 text-xs">
              <button
                type="button"
                className="px-3 py-1.5 rounded-xl bg-white text-dark-950"
              >
                {tr("دردشة", "Chat")}
              </button>
              <button
                type="button"
                disabled
                title={tr(
                  "سيُفعّل بعد إضافة Agent Loop آمن",
                  "Available after a secure agent loop is added",
                )}
                className="px-3 py-1.5 rounded-xl text-dark-500 dark:text-dark-600"
              >
                {tr("وكيل قريبًا", "Agent soon")}
              </button>
            </div>
            <div className="relative group">
              <button
                className="flex items-center gap-2 text-sm px-3 py-2 max-w-[9.5rem] sm:max-w-none bg-dark-100 dark:bg-dark-800 rounded-2xl border border-dark-200 dark:border-dark-700"
                aria-haspopup="listbox"
                aria-label={tr("اختيار المزود", "Select provider")}
              >
                <span className="truncate">
                  {selectedProvider?.name || tr("اختر مزود", "Select provider")}
                </span>
                <ChevronDown size={14} />
              </button>
              <div
                className="absolute end-0 mt-2 w-[min(18rem,calc(100vw-1.5rem))] bg-white dark:bg-dark-900 border border-dark-200 dark:border-dark-700 rounded-2xl shadow-2xl py-1 z-50 hidden group-hover:block group-focus-within:block"
                role="listbox"
                aria-label={tr("المزودون المتاحون", "Available providers")}
              >
                {availableProviders.map((provider) => (
                  <button
                    key={provider.id}
                    onClick={() => void selectProvider(provider)}
                    className="w-full text-start px-4 py-2.5 hover:bg-dark-100 dark:hover:bg-dark-800 cursor-pointer text-sm flex justify-between"
                    role="option"
                    aria-selected={selectedProvider?.id === provider.id}
                  >
                    <span className="min-w-0">
                      <span className="block truncate">{provider.name}</span>
                      {provider.credentialMode === "platform" &&
                        platformUsage && (
                          <span className="block text-[10px] text-dark-500 mt-0.5">
                            {tr(
                              `${platformUsage.requestsUsed} من ${platformUsage.requestsLimit} طلب اليوم`,
                              `${platformUsage.requestsUsed} of ${platformUsage.requestsLimit} requests today`,
                            )}
                          </span>
                        )}
                    </span>
                    <span className="text-[10px] text-emerald-400">
                      {provider.id === "session"
                        ? tr("جلسة", "Session")
                        : provider.status === "connected"
                          ? tr("متصل", "Connected")
                          : provider.status}
                    </span>
                  </button>
                ))}
                {availableProviders.length === 0 && (
                  <div className="px-4 py-3 text-xs text-dark-500">
                    {tr(
                      "أضف مزودًا من صفحة المزودات",
                      "Add a provider from the Providers page",
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
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
        <div className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-5 sm:space-y-6 bg-transparent">
          {messages.length === 0 && !isStreaming && (
            <div className="h-full flex flex-col items-center justify-center text-center">
              <Bot className="text-primary-400 mb-4" size={40} />
              <h3 className="text-2xl font-semibold mb-2">
                {tr("كيف يمكنني مساعدتك اليوم؟", "How can I help today?")}
              </h3>
              <p className="text-dark-400 mb-5">
                {selectedProvider
                  ? tr(
                      "اكتب رسالة أو أرفق صورة أو ملفًا نصيًا للبدء.",
                      "Type a message or attach an image or text file to begin.",
                    )
                  : tr(
                      "اختر مزودًا اختبرته فعليًا ثم ابدأ محادثة حقيقية.",
                      "Select a provider you have verified, then start a live conversation.",
                    )}
              </p>
              {!selectedProvider && (
                <Link to="/providers" className="btn btn-primary">
                  {tr("إضافة واختبار مزود", "Add and verify a provider")}
                </Link>
              )}
            </div>
          )}
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`message-bubble ${message.role === "user" ? "user-message" : "assistant-message"}`}
              >
                {message.role === "assistant" && (
                  <div className="flex items-center gap-2 text-xs text-dark-400 mb-2">
                    <Bot size={14} /> {message.model || selectedModel}
                  </div>
                )}
                <MessageAttachments
                  attachments={message.attachments}
                  isUser={message.role === "user"}
                  tr={tr}
                />
                <div
                  className={`prose prose-sm max-w-none ${message.role === "user" ? "prose-invert" : "dark:prose-invert"}`}
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {message.content}
                  </ReactMarkdown>
                </div>
                {message.tokens ? (
                  <div className="text-[10px] text-dark-500 mt-2">
                    {message.tokens} {tr("رمز", "tokens")}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
          {isStreaming && (
            <div className="flex justify-start" aria-live="polite">
              <div className="message-bubble assistant-message">
                <div className="text-xs text-dark-400 mb-2">
                  <Bot size={14} className="inline" /> {selectedModel} {"•"}{" "}
                  {tr("يكتب...", "Writing...")}
                </div>
                <div className="prose dark:prose-invert prose-sm">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {streamingContent || tr("جارٍ التفكير...", "Thinking...")}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
        <div
          className={`relative border-t p-3 sm:p-4 bg-white dark:bg-dark-900 flex-shrink-0 transition-colors ${isDraggingFiles ? "border-primary-500 bg-primary-50 dark:bg-primary-950/30" : "border-dark-200 dark:border-dark-700"}`}
          onDragEnter={onDragEnter}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          {isDraggingFiles && (
            <div
              className="absolute inset-2 z-20 rounded-2xl border-2 border-dashed border-primary-500 bg-primary-50/95 dark:bg-primary-950/95 text-primary-700 dark:text-primary-200 flex items-center justify-center gap-2 pointer-events-none"
              role="status"
            >
              <UploadCloud size={22} />
              <span className="font-medium">
                {tr("أفلت الملفات هنا", "Drop files here")}
              </span>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ATTACHMENT_ACCEPT}
            onChange={onFileInput}
            className="sr-only"
            tabIndex={-1}
          />
          <div className="max-w-4xl mx-auto">
            {attachments.length > 0 && (
              <div
                className="mb-3"
                aria-label={tr("المرفقات الجاهزة", "Pending attachments")}
              >
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {attachments.map((attachment, index) => {
                    const name = attachment.name || tr("مرفق", "Attachment");
                    return (
                      <div
                        key={`${name}-${index}`}
                        className="relative min-w-44 max-w-56 rounded-xl border border-dark-200 dark:border-dark-700 bg-dark-50 dark:bg-dark-800 p-2 flex items-center gap-2"
                      >
                        {attachment.type === "image" ? (
                          <img
                            src={attachment.dataUrl}
                            alt=""
                            className="w-10 h-10 rounded-lg object-cover shrink-0"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-lg bg-primary-500/10 text-primary-600 dark:text-primary-300 grid place-items-center shrink-0">
                            <FileText size={18} />
                          </div>
                        )}
                        <div className="min-w-0 pe-6">
                          <div className="text-xs font-medium truncate">
                            {name}
                          </div>
                          <div className="text-[10px] text-dark-500">
                            {formatAttachmentSize(attachment.size || 0)}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setAttachments((current) =>
                              current.filter(
                                (_, itemIndex) => itemIndex !== index,
                              ),
                            )
                          }
                          className="absolute top-1.5 end-1.5 icon-button !p-1"
                          aria-label={tr(`إزالة ${name}`, `Remove ${name}`)}
                        >
                          <X size={13} />
                        </button>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-1.5 text-[10px] text-dark-500">
                  {tr(
                    `${attachments.length} من ${MAX_ATTACHMENT_COUNT} • ${formatAttachmentSize(attachmentBytes)} من 3 MB`,
                    `${attachments.length} of ${MAX_ATTACHMENT_COUNT} • ${formatAttachmentSize(attachmentBytes)} of 3 MB`,
                  )}
                </div>
              </div>
            )}
            <div className="flex gap-2 sm:gap-3 items-end">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={
                  isStreaming || attachments.length >= MAX_ATTACHMENT_COUNT
                }
                className="btn btn-secondary h-12 w-12 p-0 shrink-0 rounded-2xl"
                aria-label={tr(
                  "إرفاق صورة أو ملف نصي",
                  "Attach an image or text file",
                )}
                title={tr(
                  "حتى 3 ملفات وإجمالي 3 MB",
                  "Up to 3 files and 3 MB total",
                )}
              >
                <Paperclip size={18} />
              </button>
              <textarea
                id="chat-message"
                aria-label={tr("رسالتك", "Your message")}
                ref={textareaRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                placeholder={tr(
                  "اكتب رسالتك... (Shift+Enter لسطر جديد)",
                  "Type your message... (Shift+Enter for a new line)",
                )}
                className="textarea flex-1 py-3.5"
                disabled={isStreaming}
                rows={1}
              />
              {isStreaming ? (
                <button
                  onClick={stopGeneration}
                  className="btn btn-danger h-12 w-12 p-0 flex items-center justify-center rounded-2xl"
                  aria-label={tr("إيقاف التوليد", "Stop generation")}
                >
                  <Square size={18} />
                </button>
              ) : (
                <button
                  onClick={() => void sendMessage()}
                  disabled={
                    (!input.trim() && attachments.length === 0) || !currentChat
                  }
                  className="btn btn-primary h-12 w-12 p-0 flex items-center justify-center rounded-2xl disabled:bg-dark-200 dark:disabled:bg-dark-700"
                  aria-label={tr("إرسال الرسالة", "Send message")}
                >
                  <Send size={18} />
                </button>
              )}
            </div>
          </div>
          <div className="text-[10px] text-dark-500 mt-2 text-center">
            {tr(
              "PNG، JPEG، WebP، TXT، Markdown، JSON • Enter للإرسال",
              "PNG, JPEG, WebP, TXT, Markdown, JSON • Press Enter to send",
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageAttachments({
  attachments,
  isUser,
  tr,
}: {
  attachments: Message["attachments"];
  isUser: boolean;
  tr: (arabic: string, english: string) => string;
}) {
  if (!attachments?.length) return null;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
      {attachments.map((attachment, index) => {
        const name = attachment.name || tr("مرفق", "Attachment");
        const hasPreview =
          attachment.type === "image" && "dataUrl" in attachment;
        return (
          <div
            key={`${name}-${index}`}
            className={`min-w-0 rounded-xl border overflow-hidden ${isUser ? "bg-white/10 border-white/20" : "bg-dark-50 dark:bg-dark-900 border-dark-200 dark:border-dark-700"}`}
          >
            {hasPreview ? (
              <img
                src={attachment.dataUrl}
                alt={name}
                className="w-full h-32 object-cover"
                loading="lazy"
              />
            ) : null}
            <div className="flex items-center gap-2 p-2.5 min-w-0">
              {attachment.type === "image" ? (
                <ImageIcon size={15} className="shrink-0" aria-hidden="true" />
              ) : (
                <FileText size={15} className="shrink-0" aria-hidden="true" />
              )}
              <span className="text-xs truncate flex-1">{name}</span>
              {attachment.size !== undefined ? (
                <span className="text-[10px] opacity-70 shrink-0">
                  {formatAttachmentSize(attachment.size)}
                </span>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

import { Bot, Download, FileText, Image as ImageIcon, UserRound } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message } from "../../types";
import type { CodeArtifact } from "../../lib/code-artifacts";
import AiMessageContent from "./AiMessageContent";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
    <div className="chat-message-attachments" aria-label={tr("مرفقات الرسالة", "Message attachments")}>
      {attachments.map((attachment, index) => {
        const name = attachment.name || tr("مرفق", "Attachment");
        const inlinePreview = attachment.type === "image" && "dataUrl" in attachment;
        const storedPreview =
          attachment.type === "image" &&
          "downloadUrl" in attachment &&
          Boolean(attachment.downloadUrl);
        const imageUrl = inlinePreview
          ? attachment.dataUrl
          : storedPreview && "downloadUrl" in attachment
            ? attachment.downloadUrl
            : undefined;

        return (
          <div
            key={`${name}-${index}`}
            className={`chat-attachment-card ${isUser ? "is-user" : ""}`}
          >
            {imageUrl ? (
              <img src={imageUrl} alt={name} loading="lazy" />
            ) : null}
            <div className="chat-attachment-meta">
              {attachment.type === "image" ? (
                <ImageIcon size={16} aria-hidden="true" />
              ) : (
                <FileText size={16} aria-hidden="true" />
              )}
              <span title={name}>{name}</span>
              {"downloadUrl" in attachment && attachment.downloadUrl ? (
                <a
                  href={`${attachment.downloadUrl}?download=1`}
                  download
                  aria-label={tr(`تنزيل ${name}`, `Download ${name}`)}
                >
                  <Download size={15} />
                </a>
              ) : null}
              {attachment.size !== undefined ? <small>{formatSize(attachment.size)}</small> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ChatMessage({
  message,
  selectedModel,
  timeLabel,
  canSaveProject,
  onSaveProject,
  tr,
}: {
  message: Message;
  selectedModel: string;
  timeLabel: string;
  canSaveProject: boolean;
  onSaveProject: (artifacts: CodeArtifact[]) => void;
  tr: (arabic: string, english: string) => string;
}) {
  const isUser = message.role === "user";

  return (
    <article className={`chat-message-row ${isUser ? "is-user" : "is-assistant"}`}>
      <div className="chat-message-avatar" aria-hidden="true">
        {isUser ? <UserRound size={17} /> : <Bot size={17} />}
      </div>
      <div className="chat-message-body">
        <header className="chat-message-header">
          <strong>{isUser ? tr("أنت", "You") : "Moataz AI"}</strong>
          {!isUser && (message.model || selectedModel) ? (
            <span dir="ltr">{message.model || selectedModel}</span>
          ) : null}
          <time dateTime={message.createdAt}>{timeLabel}</time>
        </header>
        <div className={`message-bubble ${isUser ? "user-message" : "assistant-message"}`}>
          <MessageAttachments attachments={message.attachments} isUser={isUser} tr={tr} />
          {isUser ? (
            <div className="chat-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
            </div>
          ) : (
            <AiMessageContent
              content={message.content}
              canSaveProject={canSaveProject}
              onSaveProject={onSaveProject}
            />
          )}
          {message.tokens ? (
            <div className="chat-token-count">
              {message.tokens} {tr("رمزًا", "tokens")}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

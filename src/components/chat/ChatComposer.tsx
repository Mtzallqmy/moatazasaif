import { useEffect, useRef, useState, type DragEvent } from "react";
import { FileText, Paperclip, Send, Square, UploadCloud, X } from "lucide-react";
import type { ChatAttachment } from "../../types";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ChatComposer({
  value,
  attachments,
  accept,
  maxFiles,
  maxBytes,
  disabled,
  isStreaming,
  onChange,
  onFiles,
  onRemoveAttachment,
  onSend,
  onStop,
  tr,
}: {
  value: string;
  attachments: ChatAttachment[];
  accept: string;
  maxFiles: number;
  maxBytes: number;
  disabled: boolean;
  isStreaming: boolean;
  onChange: (value: string) => void;
  onFiles: (files: File[]) => Promise<void> | void;
  onRemoveAttachment: (index: number) => void;
  onSend: () => Promise<void> | void;
  onStop: () => void;
  tr: (arabic: string, english: string) => string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [readingFiles, setReadingFiles] = useState(false);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 192)}px`;
  }, [value]);

  const addFiles = async (files: File[]) => {
    if (!files.length) return;
    setReadingFiles(true);
    try {
      await onFiles(files);
    } finally {
      setReadingFiles(false);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (!disabled && !isStreaming) void addFiles(Array.from(event.dataTransfer.files));
  };
  const bytes = attachments.reduce((total, attachment) => total + (attachment.size || 0), 0);
  const canSend = !disabled && !readingFiles && (Boolean(value.trim()) || attachments.length > 0);

  return (
    <footer
      className={`chat-composer-zone ${dragging ? "is-dragging" : ""}`}
      onDragEnter={(event) => {
        event.preventDefault();
        if (!event.dataTransfer.types.includes("Files")) return;
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDrop={onDrop}
    >
      {dragging ? (
        <div className="chat-drop-target" role="status">
          <UploadCloud size={22} />
          <strong>{tr("أفلت الملفات لإرفاقها", "Drop files to attach")}</strong>
        </div>
      ) : null}
      <div className="chat-composer-wrap">
        {attachments.length ? (
          <div className="chat-pending-files" aria-label={tr("المرفقات الجاهزة", "Pending attachments")}>
            <div className="chat-pending-files-list">
              {attachments.map((attachment, index) => {
                const name = attachment.name || tr("مرفق", "Attachment");
                return (
                  <div className="chat-pending-file" key={`${name}-${index}`}>
                    {attachment.type === "image" ? (
                      <img src={attachment.dataUrl} alt="" />
                    ) : (
                      <span className="chat-file-icon"><FileText size={17} /></span>
                    )}
                    <span className="chat-pending-file-name" title={name}>{name}</span>
                    <small>{formatSize(attachment.size || 0)}</small>
                    <button type="button" onClick={() => onRemoveAttachment(index)} aria-label={tr(`إزالة ${name}`, `Remove ${name}`)}>
                      <X size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="chat-file-budget">
              <span>{tr(`${attachments.length} من ${maxFiles} ملفات`, `${attachments.length} of ${maxFiles} files`)}</span>
              <span>{formatSize(bytes)} / {formatSize(maxBytes)}</span>
            </div>
          </div>
        ) : null}

        <div className="chat-composer">
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={accept}
            tabIndex={-1}
            className="sr-only"
            onChange={(event) => {
              const files = Array.from(event.target.files || []);
              event.target.value = "";
              void addFiles(files);
            }}
          />
          <button
            type="button"
            className="chat-composer-action"
            onClick={() => inputRef.current?.click()}
            disabled={disabled || isStreaming || readingFiles || attachments.length >= maxFiles}
            aria-label={tr("إرفاق صورة أو ملف", "Attach an image or file")}
            title={tr(`حتى ${maxFiles} ملفات`, `Up to ${maxFiles} files`)}
          >
            {readingFiles ? <span className="chat-mini-spinner" /> : <Paperclip size={20} />}
          </button>
          <textarea
            ref={textareaRef}
            value={value}
            disabled={isStreaming}
            rows={1}
            aria-label={tr("رسالتك", "Your message")}
            placeholder={tr("اكتب رسالتك أو اطلب تحليل الملفات…", "Message Moataz AI or ask about your files…")}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                if (canSend) void onSend();
              }
            }}
          />
          {isStreaming ? (
            <button type="button" className="chat-send-button is-stop" onClick={onStop} aria-label={tr("إيقاف التوليد", "Stop generation")}>
              <Square size={18} />
            </button>
          ) : (
            <button type="button" className="chat-send-button" onClick={() => void onSend()} disabled={!canSend} aria-label={tr("إرسال الرسالة", "Send message")}>
              <Send size={19} />
            </button>
          )}
        </div>
        <div className="chat-composer-help">
          <span>{tr("Enter للإرسال • Shift+Enter لسطر جديد", "Enter to send • Shift+Enter for a new line")}</span>
          <span>{tr("صور وملفات نصية وبرمجية", "Images, text, and code files")}</span>
        </div>
      </div>
    </footer>
  );
}

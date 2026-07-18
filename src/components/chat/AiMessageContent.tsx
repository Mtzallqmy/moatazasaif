import { Copy, Download, FileCode2, FolderPlus } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { toast } from 'sonner'
import { extractCodeArtifacts, type CodeArtifact } from '../../lib/code-artifacts'
import { usePreferences } from '../../contexts/PreferencesContext'

function saveText(name: string, content: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type: type + ';charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

export default function AiMessageContent({ content, canSaveProject, onSaveProject, streaming = false }: { content: string; canSaveProject?: boolean; onSaveProject?: (artifacts: CodeArtifact[]) => void; streaming?: boolean }) {
  const { tr } = usePreferences()
  const artifacts = extractCodeArtifacts(content)
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(tr('تم النسخ', 'Copied'))
    } catch {
      toast.error(tr('تعذر النسخ إلى الحافظة', 'Could not copy to clipboard'))
    }
  }
  return <>
    <div className="prose prose-sm max-w-none dark:prose-invert chat-ai-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown></div>
    {!streaming && artifacts.length > 0 && <div className="mt-4 space-y-2" aria-label={tr('الملفات البرمجية الناتجة', 'Generated code files')}>
      {artifacts.map((artifact, index) => <div key={artifact.path + index} className="flex items-center gap-2 rounded-xl border border-dark-200 dark:border-dark-700 bg-dark-50 dark:bg-dark-900 p-2.5">
        <FileCode2 size={16} className="text-primary-500 shrink-0" />
        <span className="font-mono text-xs truncate flex-1" dir="ltr">{artifact.path}</span>
        <button type="button" className="icon-button !p-1.5" onClick={() => void copy(artifact.content)} aria-label={tr('نسخ الملف', 'Copy file')}><Copy size={14} /></button>
        <button type="button" className="icon-button !p-1.5" onClick={() => saveText(artifact.path.split('/').pop() || 'file.txt', artifact.content, artifact.mimeType)} aria-label={tr('تنزيل الملف', 'Download file')}><Download size={14} /></button>
      </div>)}
    </div>}
    {!streaming && <div className="mt-3 flex flex-wrap gap-2 border-t border-dark-200/70 dark:border-dark-700/70 pt-2">
      <button type="button" className="btn btn-ghost text-xs py-1.5 px-2" onClick={() => void copy(content)}><Copy size={13} /> {tr('نسخ', 'Copy')}</button>
      <button type="button" className="btn btn-ghost text-xs py-1.5 px-2" onClick={() => saveText('response.md', content, 'text/markdown')}><Download size={13} /> {tr('تنزيل', 'Download')}</button>
      {artifacts.length > 0 && canSaveProject && onSaveProject && <button type="button" className="btn btn-secondary text-xs py-1.5 px-2" onClick={() => onSaveProject(artifacts)}><FolderPlus size={13} /> {tr('حفظ كمشروع', 'Save as project')}</button>}
    </div>}
  </>
}

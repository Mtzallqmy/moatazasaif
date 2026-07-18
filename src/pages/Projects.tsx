import { useEffect, useMemo, useState } from 'react'
import { Archive, Download, FileCode2, FilePlus2, FolderKanban, Plus, Save, Trash2 } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { usePreferences } from '../contexts/PreferencesContext'
import type { Project, ProjectFile } from '../types'
import { createProject, deleteProject, deleteProjectFile, getProject, listProjects, projectExportUrl, saveProjectFile, type ProjectTemplate } from '../lib/projects-api'
import { fileMimeType, safeProjectPath } from '../../shared/file-contract'

const templateOptions: Array<{ value: ProjectTemplate; ar: string; en: string }> = [
  { value: 'empty', ar: 'فارغ', en: 'Empty' }, { value: 'vite-react', ar: 'تطبيق React', en: 'React app' },
  { value: 'node-api', ar: 'واجهة Node API', en: 'Node API' }, { value: 'python', ar: 'مشروع Python', en: 'Python project' },
]

export default function Projects() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const { tr } = usePreferences()
  const [projects, setProjects] = useState<Project[]>([])
  const [project, setProject] = useState<Project | null>(null)
  const [files, setFiles] = useState<ProjectFile[]>([])
  const [selectedPath, setSelectedPath] = useState('')
  const [draft, setDraft] = useState('')
  const [newName, setNewName] = useState('')
  const [template, setTemplate] = useState<ProjectTemplate>('empty')
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)

  const selectedFile = useMemo(() => files.find((file) => file.path === selectedPath), [files, selectedPath])
  const loadList = async () => setProjects(await listProjects())
  useEffect(() => { void loadList().catch((error) => toast.error(error instanceof Error ? error.message : tr('تعذر تحميل المشاريع', 'Could not load projects'))) }, [])
  useEffect(() => {
    if (!projectId) { setProject(null); setFiles([]); setSelectedPath(''); return }
    void getProject(projectId).then((result) => {
      setProject(result.project); setFiles(result.files)
      const first = result.files[0]; setSelectedPath(first?.path || ''); setDraft(first?.content || '')
    }).catch((error) => toast.error(error instanceof Error ? error.message : tr('تعذر فتح المشروع', 'Could not open project')))
  }, [projectId])
  useEffect(() => { setDraft(selectedFile?.content || '') }, [selectedFile?.id])

  const create = async () => {
    if (!newName.trim()) return
    setCreating(true)
    try { const next = await createProject({ name: newName.trim(), template }); setNewName(''); await loadList(); navigate('/projects/' + next.id) }
    catch (error) { toast.error(error instanceof Error ? error.message : tr('تعذر إنشاء المشروع', 'Could not create project')) }
    finally { setCreating(false) }
  }
  const save = async () => {
    if (!project || !selectedPath) return
    setSaving(true)
    try {
      const saved = await saveProjectFile(project.id, { path: selectedPath, content: draft, mimeType: selectedFile?.mimeType || fileMimeType(selectedPath) || 'text/plain' })
      setFiles((current) => current.map((file) => file.path === selectedPath ? saved : file)); toast.success(tr('تم حفظ الملف', 'File saved'))
    } catch (error) { toast.error(error instanceof Error ? error.message : tr('تعذر حفظ الملف', 'Could not save file')) }
    finally { setSaving(false) }
  }
  const addFile = async () => {
    if (!project) return
    const value = window.prompt(tr('مسار الملف الجديد، مثال src/app.ts', 'New file path, e.g. src/app.ts'))
    const path = value ? safeProjectPath(value) : null
    if (!path) return
    try { const file = await saveProjectFile(project.id, { path, content: '', mimeType: fileMimeType(path) || 'text/plain' }); setFiles((current) => [...current.filter((item) => item.path !== path), file].sort((a, b) => a.path.localeCompare(b.path))); setSelectedPath(path); setDraft('') }
    catch (error) { toast.error(error instanceof Error ? error.message : tr('تعذر إنشاء الملف', 'Could not create file')) }
  }
  const removeFile = async () => {
    if (!project || !selectedFile || !window.confirm(tr('حذف هذا الملف؟', 'Delete this file?'))) return
    await deleteProjectFile(project.id, selectedFile.path); const next = files.filter((file) => file.id !== selectedFile.id); setFiles(next); setSelectedPath(next[0]?.path || '')
  }
  const removeProject = async () => {
    if (!project || !window.confirm(tr('حذف المشروع وكل ملفاته؟', 'Delete the project and all files?'))) return
    await deleteProject(project.id); await loadList(); navigate('/projects'); toast.success(tr('تم حذف المشروع', 'Project deleted'))
  }

  return <div className="min-h-full p-4 sm:p-6 max-w-[96rem] mx-auto">
    <div className="mb-5 flex flex-col lg:flex-row lg:items-end justify-between gap-4">
      <div><div className="text-primary-500 text-sm font-semibold mb-1">AI PROJECT WORKSPACE</div><h1 className="text-2xl sm:text-3xl font-bold">{tr('المشاريع والملفات', 'Projects & files')}</h1><p className="text-dark-500 mt-1">{tr('أنشئ مشروعًا، حرّر ملفاته، واحفظ نواتج الدردشة أو صدّرها ZIP.', 'Create, edit, import chat artifacts, and export ready ZIP files.')}</p></div>
      <div className="card p-3 flex flex-wrap gap-2 items-center">
        <input className="input min-w-48 flex-1" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder={tr('اسم مشروع جديد', 'New project name')} />
        <select className="input w-auto" value={template} onChange={(event) => setTemplate(event.target.value as ProjectTemplate)}>{templateOptions.map((item) => <option key={item.value} value={item.value}>{tr(item.ar, item.en)}</option>)}</select>
        <button className="btn btn-primary" onClick={() => void create()} disabled={creating || !newName.trim()}><Plus size={16} /> {tr('إنشاء', 'Create')}</button>
      </div>
    </div>
    <div className="grid lg:grid-cols-[17rem_1fr] gap-4 min-h-[38rem]">
      <aside className="card p-3 overflow-auto">
        <div className="flex items-center gap-2 px-2 py-2 font-semibold"><FolderKanban size={18} /> {tr('مشاريعي', 'My projects')}</div>
        <div className="space-y-1">{projects.map((item) => <button key={item.id} onClick={() => navigate('/projects/' + item.id)} className={'w-full text-start rounded-xl px-3 py-3 ' + (project?.id === item.id ? 'bg-primary-600 text-white' : 'hover:bg-dark-100 dark:hover:bg-dark-800')}><span className="block font-medium truncate">{item.name}</span><span className="block text-[10px] opacity-60 mt-1">{item.fileCount} {tr('ملف', 'files')} • {item.template}</span></button>)}</div>
        {!projects.length && <div className="text-center text-dark-500 text-sm p-6">{tr('أنشئ أول مشروع من الأعلى.', 'Create your first project above.')}</div>}
      </aside>
      {!project ? <div className="card flex flex-col items-center justify-center text-center p-10"><FolderKanban size={48} className="text-primary-400 mb-4"/><h2 className="text-xl font-semibold">{tr('اختر مشروعًا أو أنشئ مشروعًا جديدًا', 'Select or create a project')}</h2></div> : <section className="card overflow-hidden grid md:grid-cols-[16rem_1fr] min-h-[38rem]">
        <div className="border-e border-dark-200 dark:border-dark-700 flex flex-col min-h-56">
          <div className="p-3 border-b border-dark-200 dark:border-dark-700"><div className="font-semibold truncate">{project.name}</div><div className="text-[10px] text-dark-500">{project.template} • {files.length} {tr('ملف', 'files')}</div></div>
          <div className="p-2 flex gap-1"><button className="btn btn-secondary flex-1 text-xs" onClick={() => void addFile()}><FilePlus2 size={14}/> {tr('ملف', 'File')}</button><a className="icon-button" href={projectExportUrl(project.id)} aria-label={tr('تصدير ZIP', 'Export ZIP')}><Download size={16}/></a></div>
          <div className="flex-1 overflow-auto px-2">{files.map((file) => <button key={file.id} onClick={() => setSelectedPath(file.path)} className={'w-full flex items-center gap-2 text-start rounded-lg px-2.5 py-2 text-xs font-mono ' + (selectedPath === file.path ? 'bg-primary-500/15 text-primary-600 dark:text-primary-300' : 'hover:bg-dark-100 dark:hover:bg-dark-800')} dir="ltr"><FileCode2 size={14} className="shrink-0"/><span className="truncate">{file.path}</span></button>)}</div>
          <button className="m-2 btn btn-ghost text-red-500 text-xs" onClick={() => void removeProject()}><Trash2 size={14}/> {tr('حذف المشروع', 'Delete project')}</button>
        </div>
        <div className="flex flex-col min-w-0">
          <div className="p-3 border-b border-dark-200 dark:border-dark-700 flex items-center justify-between gap-2"><div className="font-mono text-xs truncate" dir="ltr">{selectedPath || tr('لا يوجد ملف', 'No file')}</div><div className="flex gap-2"><button className="btn btn-ghost text-xs text-red-500" disabled={!selectedFile} onClick={() => void removeFile()}><Trash2 size={14}/></button><button className="btn btn-primary text-xs" disabled={!selectedFile || saving} onClick={() => void save()}><Save size={14}/> {saving ? tr('جارٍ الحفظ', 'Saving') : tr('حفظ', 'Save')}</button></div></div>
          {selectedFile ? <textarea value={draft} onChange={(event) => setDraft(event.target.value)} className="flex-1 min-h-[32rem] resize-none bg-dark-950 text-dark-100 p-4 sm:p-5 font-mono text-sm leading-6 outline-none" dir="ltr" spellCheck={false} aria-label={tr('محرر الملف', 'File editor')} /> : <div className="flex-1 grid place-items-center text-dark-500"><Archive size={30}/></div>}
        </div>
      </section>}
    </div>
  </div>
}

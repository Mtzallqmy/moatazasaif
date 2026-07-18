import { zipSync, strToU8 } from 'fflate'
import type { VercelRequest, VercelResponse } from '../_lib/vercel.js'
import { authenticate, getAdminClient } from '../_lib/supabase.js'
import { ApiError, methodNotAllowed, optionalString, requireString, sendError, setJsonHeaders } from '../_lib/http.js'
import { enforceRateLimit } from '../_lib/rate-limit.js'
import { MAX_PROJECT_FILE_BYTES, MAX_PROJECT_FILES, safeProjectPath } from '../../shared/file-contract.js'
import { projectTemplateFiles, type ProjectTemplate } from '../_lib/project-templates.js'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const templates = new Set<ProjectTemplate>(['empty', 'vite-react', 'node-api', 'python'])

function routeParts(req: VercelRequest) {
  const value = Array.isArray(req.query.projectRoute) ? req.query.projectRoute[0] : req.query.projectRoute
  return (value || '').split('/').filter(Boolean)
}

function mapProject(row: Record<string, unknown>) {
  return { id: row.id, name: row.name, description: row.description || '', template: row.template, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, fileCount: Number(row.file_count || 0) }
}

function mapFile(row: Record<string, unknown>) {
  return { id: row.id, projectId: row.project_id, path: row.path, content: row.content || '', mimeType: row.mime_type || 'text/plain', createdAt: row.created_at, updatedAt: row.updated_at }
}

async function ownedProject(projectId: string, userId: string) {
  if (!uuid.test(projectId)) throw new ApiError(400, 'معرّف المشروع غير صالح', 'invalid_project_id')
  const { data, error } = await getAdminClient().from('projects').select('*').eq('id', projectId).eq('user_id', userId).maybeSingle()
  if (error) throw new ApiError(500, 'تعذر قراءة المشروع', 'project_read_failed')
  if (!data) throw new ApiError(404, 'المشروع غير موجود', 'project_not_found')
  return data as Record<string, unknown>
}

function validateFile(input: Record<string, unknown>) {
  const path = safeProjectPath(requireString(input.path, 'path', 240))
  if (!path) throw new ApiError(400, 'مسار الملف غير صالح', 'project_path_invalid')
  if (typeof input.content !== 'string') throw new ApiError(400, 'محتوى الملف غير صالح', 'project_content_invalid')
  if (Buffer.byteLength(input.content, 'utf8') > MAX_PROJECT_FILE_BYTES) throw new ApiError(413, 'حجم ملف المشروع يتجاوز 2 MB', 'project_file_too_large')
  return { path, content: input.content, mime_type: optionalString(input.mimeType, 120) || 'text/plain' }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const auth = await authenticate(req)
    const admin = getAdminClient()
    const parts = routeParts(req)
    if (parts.length === 0 && req.method === 'GET') {
      setJsonHeaders(res)
      const { data, error } = await admin.from('projects').select('*, project_files(count)').eq('user_id', auth.user.id).order('updated_at', { ascending: false })
      if (error) throw new ApiError(500, 'تعذر تحميل المشاريع', 'project_list_failed')
      return res.status(200).json({ projects: (data || []).map((raw) => { const row = raw as Record<string, unknown> & { project_files?: Array<{ count: number }> }; return mapProject({ ...row, file_count: row.project_files?.[0]?.count || 0 }) }) })
    }
    if (parts.length === 0 && req.method === 'POST') {
      setJsonHeaders(res)
      await enforceRateLimit(req, 'project_create', 30, 3600, auth.user.id)
      const name = requireString(req.body?.name, 'name', 120)
      const description = optionalString(req.body?.description, 2000) || ''
      const template = templates.has(req.body?.template) ? req.body.template as ProjectTemplate : 'empty'
      const { count, error: countError } = await admin.from('projects').select('id', { count: 'exact', head: true }).eq('user_id', auth.user.id)
      if (countError) throw new ApiError(500, 'تعذر التحقق من حد المشاريع', 'project_limit_check_failed')
      if ((count || 0) >= 100) throw new ApiError(409, 'وصلت إلى الحد الأقصى للمشاريع', 'project_limit_reached')
      const { data, error } = await admin.from('projects').insert({ user_id: auth.user.id, name, description, template }).select('*').single()
      if (error || !data) throw new ApiError(500, 'تعذر إنشاء المشروع', 'project_create_failed')
      const initial = projectTemplateFiles(template, name).map((file) => ({ ...file, project_id: data.id, user_id: auth.user.id, mime_type: file.mimeType }))
      const { error: filesError } = await admin.from('project_files').insert(initial.map(({ mimeType: _mimeType, ...file }) => file))
      if (filesError) { await admin.from('projects').delete().eq('id', data.id).eq('user_id', auth.user.id); throw new ApiError(500, 'تعذر إنشاء ملفات القالب', 'project_template_failed') }
      return res.status(201).json({ project: mapProject({ ...(data as Record<string, unknown>), file_count: initial.length }) })
    }

    const project = await ownedProject(parts[0] || '', auth.user.id)
    const projectId = String(project.id)
    if (parts.length === 1 && req.method === 'GET') {
      setJsonHeaders(res)
      const { data, error } = await admin.from('project_files').select('*').eq('project_id', projectId).eq('user_id', auth.user.id).order('path')
      if (error) throw new ApiError(500, 'تعذر تحميل ملفات المشروع', 'project_files_failed')
      return res.status(200).json({ project: mapProject({ ...project, file_count: data?.length || 0 }), files: (data || []).map((row) => mapFile(row as Record<string, unknown>)) })
    }
    if (parts.length === 1 && req.method === 'PATCH') {
      setJsonHeaders(res)
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (req.body?.name !== undefined) patch.name = requireString(req.body.name, 'name', 120)
      if (req.body?.description !== undefined) patch.description = optionalString(req.body.description, 2000) || ''
      if (req.body?.status !== undefined) patch.status = req.body.status === 'archived' ? 'archived' : 'active'
      if (Object.keys(patch).length === 1) throw new ApiError(400, 'لا توجد تغييرات صالحة', 'empty_project_update')
      const { data, error } = await admin.from('projects').update(patch).eq('id', projectId).eq('user_id', auth.user.id).select('*').single()
      if (error || !data) throw new ApiError(500, 'تعذر تحديث المشروع', 'project_update_failed')
      return res.status(200).json({ project: mapProject(data as Record<string, unknown>) })
    }
    if (parts.length === 1 && req.method === 'DELETE') {
      setJsonHeaders(res)
      const { error } = await admin.from('projects').delete().eq('id', projectId).eq('user_id', auth.user.id)
      if (error) throw new ApiError(500, 'تعذر حذف المشروع', 'project_delete_failed')
      return res.status(204).send('')
    }
    if (parts.length === 2 && parts[1] === 'files' && req.method === 'POST') {
      setJsonHeaders(res)
      await enforceRateLimit(req, 'project_file_write', 240, 3600, auth.user.id)
      const file = validateFile(req.body || {})
      const { count, error: countError } = await admin.from('project_files').select('id', { count: 'exact', head: true }).eq('project_id', projectId).eq('user_id', auth.user.id)
      if (countError) throw new ApiError(500, 'تعذر التحقق من حد الملفات', 'project_file_limit_check_failed')
      const { data: existing } = await admin.from('project_files').select('id').eq('project_id', projectId).eq('path', file.path).eq('user_id', auth.user.id).maybeSingle()
      if (!existing && (count || 0) >= MAX_PROJECT_FILES) throw new ApiError(409, 'وصل المشروع إلى الحد الأقصى للملفات', 'project_file_limit_reached')
      const { data, error } = await admin.from('project_files').upsert({ project_id: projectId, user_id: auth.user.id, ...file, updated_at: new Date().toISOString() }, { onConflict: 'project_id,path' }).select('*').single()
      if (error || !data) throw new ApiError(500, 'تعذر حفظ الملف', 'project_file_save_failed')
      await admin.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', projectId).eq('user_id', auth.user.id)
      return res.status(200).json({ file: mapFile(data as Record<string, unknown>) })
    }
    if (parts.length === 2 && parts[1] === 'files' && req.method === 'DELETE') {
      setJsonHeaders(res)
      const path = safeProjectPath(requireString(req.body?.path, 'path', 240))
      if (!path) throw new ApiError(400, 'مسار الملف غير صالح', 'project_path_invalid')
      const { error } = await admin.from('project_files').delete().eq('project_id', projectId).eq('path', path).eq('user_id', auth.user.id)
      if (error) throw new ApiError(500, 'تعذر حذف الملف', 'project_file_delete_failed')
      await admin.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', projectId).eq('user_id', auth.user.id)
      return res.status(204).send('')
    }
    if (parts.length === 2 && parts[1] === 'artifacts' && req.method === 'POST') {
      setJsonHeaders(res)
      const inputs: unknown[] = Array.isArray(req.body?.files) ? req.body.files : []
      if (!inputs.length || inputs.length > 30) throw new ApiError(400, 'عدد الملفات المستوردة غير صالح', 'artifact_count_invalid')
      const files = inputs.map((input: unknown) => validateFile(input as Record<string, unknown>))
      const { count, error: countError } = await admin.from('project_files').select('id', { count: 'exact', head: true }).eq('project_id', projectId).eq('user_id', auth.user.id)
      if (countError) throw new ApiError(500, 'تعذر التحقق من حد الملفات', 'project_file_limit_check_failed')
      if ((count || 0) + files.length > MAX_PROJECT_FILES) throw new ApiError(409, 'عدد ملفات المشروع سيتجاوز الحد المسموح', 'project_file_limit_reached')
      const rows = files.map((file: ReturnType<typeof validateFile>) => ({ project_id: projectId, user_id: auth.user.id, ...file, updated_at: new Date().toISOString() }))
      const { data, error } = await admin.from('project_files').upsert(rows, { onConflict: 'project_id,path' }).select('*')
      if (error) throw new ApiError(500, 'تعذر استيراد الملفات', 'artifact_import_failed')
      await admin.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', projectId).eq('user_id', auth.user.id)
      return res.status(200).json({ files: (data || []).map((row) => mapFile(row as Record<string, unknown>)) })
    }
    if (parts.length === 2 && parts[1] === 'export' && req.method === 'GET') {
      await enforceRateLimit(req, 'project_export', 60, 3600, auth.user.id)
      const { data, error } = await admin.from('project_files').select('path,content').eq('project_id', projectId).eq('user_id', auth.user.id)
      if (error) throw new ApiError(500, 'تعذر قراءة ملفات التصدير', 'project_export_read_failed')
      const archive: Record<string, Uint8Array> = {}
      for (const row of data || []) archive[String(row.path)] = strToU8(String(row.content || ''))
      const zipped = Buffer.from(zipSync(archive, { level: 6 }))
      const name = String(project.name || 'project').replace(/[^\p{L}\p{N}_.-]+/gu, '-').slice(0, 80) || 'project'
      res.setHeader('Content-Type', 'application/zip')
      res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(name + '.zip'))
      res.setHeader('Content-Length', String(zipped.byteLength))
      res.setHeader('Cache-Control', 'private, no-store')
      res.setHeader('X-Content-Type-Options', 'nosniff')
      return res.status(200).send(zipped)
    }
    setJsonHeaders(res)
    return methodNotAllowed(res, ['GET', 'POST', 'PATCH', 'DELETE'])
  } catch (error) {
    setJsonHeaders(res)
    return sendError(res, error)
  }
}

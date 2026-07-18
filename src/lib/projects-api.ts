import type { Project, ProjectFile } from '../types'
import { apiJson, authHeaders } from './api'

export type ProjectTemplate = Project['template']

export async function listProjects() {
  const body = await apiJson<{ projects: Project[] }>('/api/projects', { headers: await authHeaders(false) })
  return body.projects || []
}

export async function createProject(input: { name: string; description?: string; template?: ProjectTemplate }) {
  const body = await apiJson<{ project: Project }>('/api/projects', { method: 'POST', headers: await authHeaders(), body: JSON.stringify(input) })
  return body.project
}

export async function getProject(id: string) {
  return apiJson<{ project: Project; files: ProjectFile[] }>('/api/projects/' + encodeURIComponent(id), { headers: await authHeaders(false) })
}

export async function updateProject(id: string, patch: Partial<Pick<Project, 'name' | 'description' | 'status'>>) {
  const body = await apiJson<{ project: Project }>('/api/projects/' + encodeURIComponent(id), { method: 'PATCH', headers: await authHeaders(), body: JSON.stringify(patch) })
  return body.project
}

export async function deleteProject(id: string) {
  await apiJson('/api/projects/' + encodeURIComponent(id), { method: 'DELETE', headers: await authHeaders(false) })
}

export async function saveProjectFile(projectId: string, file: Pick<ProjectFile, 'path' | 'content' | 'mimeType'>) {
  const body = await apiJson<{ file: ProjectFile }>('/api/projects/' + encodeURIComponent(projectId) + '/files', { method: 'POST', headers: await authHeaders(), body: JSON.stringify(file) })
  return body.file
}

export async function deleteProjectFile(projectId: string, path: string) {
  await apiJson('/api/projects/' + encodeURIComponent(projectId) + '/files', { method: 'DELETE', headers: await authHeaders(), body: JSON.stringify({ path }) })
}

export async function importProjectArtifacts(projectId: string, files: Array<{ path: string; content: string; mimeType: string }>) {
  const body = await apiJson<{ files: ProjectFile[] }>('/api/projects/' + encodeURIComponent(projectId) + '/artifacts', { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ files }) })
  return body.files
}

export function projectExportUrl(projectId: string) {
  return '/api/projects/' + encodeURIComponent(projectId) + '/export'
}

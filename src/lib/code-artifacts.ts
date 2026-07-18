import { safeProjectPath } from '../../shared/file-contract'

export type CodeArtifact = { path: string; language: string; content: string; mimeType: string }

const extensionByLanguage: Record<string, string> = {
  javascript: 'js', js: 'js', jsx: 'jsx', typescript: 'ts', ts: 'ts', tsx: 'tsx',
  python: 'py', py: 'py', html: 'html', css: 'css', json: 'json', markdown: 'md', md: 'md',
  yaml: 'yaml', yml: 'yml', sql: 'sql', bash: 'sh', shell: 'sh', sh: 'sh', xml: 'xml', text: 'txt',
}

const mimeByExtension: Record<string, string> = {
  js: 'text/javascript', jsx: 'text/javascript', ts: 'text/typescript', tsx: 'text/typescript', py: 'text/x-python',
  html: 'text/html', css: 'text/css', json: 'application/json', md: 'text/markdown', yaml: 'application/yaml',
  yml: 'application/yaml', sql: 'application/sql', sh: 'text/x-shellscript', xml: 'application/xml', txt: 'text/plain',
}

export function extractCodeArtifacts(markdown: string): CodeArtifact[] {
  const artifacts: CodeArtifact[] = []
  const expression = /```([^\n]*)\n([\s\S]*?)```/g
  for (const match of markdown.matchAll(expression)) {
    const info = match[1].trim()
    const content = match[2].replace(/\n$/, '')
    if (!content.trim()) continue
    const tokens = info.split(/\s+/).filter(Boolean)
    const language = (tokens[0] || 'text').toLowerCase()
    const named = info.match(/(?:filename|file|path)=(?:"([^"]+)"|'([^']+)'|([^\s]+))/i)
    const pathToken = tokens.slice(1).find((token) => token.includes('/') || /\.[a-z0-9]+$/i.test(token))
    const extension = extensionByLanguage[language] || 'txt'
    const candidate = named?.[1] || named?.[2] || named?.[3] || pathToken || 'generated/file-' + (artifacts.length + 1) + '.' + extension
    const path = safeProjectPath(candidate.replace(/^['"]|['"]$/g, ''))
    if (!path) continue
    const actualExtension = path.split('.').pop()?.toLowerCase() || extension
    artifacts.push({ path, language, content, mimeType: mimeByExtension[actualExtension] || 'text/plain' })
  }
  return artifacts
}

export type ProjectTemplate = 'empty' | 'vite-react' | 'node-api' | 'python'

export type ProjectTemplateFile = {
  path: string
  content: string
  mimeType: string
}

const readme = (name: string) => '# ' + name + '\n\nمشروع أُنشئ داخل مساحة عمل Moataz AI.\n'

export function projectTemplateFiles(template: ProjectTemplate, name: string): ProjectTemplateFile[] {
  if (template === 'vite-react') return [
    { path: 'README.md', content: readme(name) + '\n## التشغيل\n\n```bash\nnpm install\nnpm run dev\n```\n', mimeType: 'text/markdown' },
    { path: 'package.json', content: JSON.stringify({ name: name.toLowerCase().replace(/[^a-z0-9-]+/g, '-') || 'moataz-project', private: true, version: '0.1.0', type: 'module', scripts: { dev: 'vite', build: 'vite build' }, dependencies: { '@vitejs/plugin-react': '^4.3.4', vite: '^6.0.0', typescript: '^5.7.2', react: '^18.3.1', 'react-dom': '^18.3.1' }, devDependencies: {} }, null, 2) + '\n', mimeType: 'application/json' },
    { path: 'index.html', content: '<!doctype html>\n<html lang="ar" dir="rtl"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>' + name + '</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n', mimeType: 'text/html' },
    { path: 'src/main.tsx', content: "import React from 'react'\nimport { createRoot } from 'react-dom/client'\nimport './styles.css'\n\nfunction App() {\n  return <main><h1>" + name.replace(/[<>]/g, '') + "</h1><p>ابدأ البناء من هنا.</p></main>\n}\n\ncreateRoot(document.getElementById('root')!).render(<App />)\n", mimeType: 'text/typescript' },
    { path: 'src/styles.css', content: ':root { font-family: system-ui, sans-serif; color-scheme: light dark; }\nbody { margin: 0; min-height: 100vh; }\nmain { max-width: 72rem; margin: 0 auto; padding: 4rem 1.5rem; }\n', mimeType: 'text/css' },
  ]
  if (template === 'node-api') return [
    { path: 'README.md', content: readme(name) + '\n## التشغيل\n\n```bash\nnpm install\nnpm start\n```\n', mimeType: 'text/markdown' },
    { path: 'package.json', content: JSON.stringify({ name: name.toLowerCase().replace(/[^a-z0-9-]+/g, '-') || 'moataz-api', private: true, version: '0.1.0', type: 'module', scripts: { start: 'node src/server.js' }, engines: { node: '>=20' } }, null, 2) + '\n', mimeType: 'application/json' },
    { path: 'src/server.js', content: "import { createServer } from 'node:http'\n\nconst port = Number(process.env.PORT || 3000)\nconst server = createServer((request, response) => {\n  response.setHeader('Content-Type', 'application/json; charset=utf-8')\n  response.end(JSON.stringify({ status: 'ok', path: request.url }))\n})\nserver.listen(port, () => console.log('Listening on http://localhost:' + port))\n", mimeType: 'text/javascript' },
    { path: '.env.example', content: 'PORT=3000\n', mimeType: 'text/plain' },
  ]
  if (template === 'python') return [
    { path: 'README.md', content: readme(name) + '\n## التشغيل\n\n```bash\npython -m venv .venv\npython main.py\n```\n', mimeType: 'text/markdown' },
    { path: 'main.py', content: 'def main():\n    print("' + name.replace(/["\\]/g, '') + '")\n\n\nif __name__ == "__main__":\n    main()\n', mimeType: 'text/x-python' },
    { path: 'requirements.txt', content: '', mimeType: 'text/plain' },
    { path: '.gitignore', content: '.venv/\n__pycache__/\n.env\n', mimeType: 'text/plain' },
  ]
  return [{ path: 'README.md', content: readme(name), mimeType: 'text/markdown' }]
}

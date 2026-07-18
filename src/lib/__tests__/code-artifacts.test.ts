import { describe, expect, it } from 'vitest'
import { extractCodeArtifacts } from '../code-artifacts'

describe('code artifact extraction', () => {
  it('extracts explicit safe paths and infers unnamed paths', () => {
    const result = extractCodeArtifacts('```tsx path=src/App.tsx\nexport default function App() {}\n```\n```python\nprint("ok")\n```')
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ path: 'src/App.tsx', mimeType: 'text/typescript' })
    expect(result[1]).toMatchObject({ path: 'generated/file-2.py', mimeType: 'text/x-python' })
  })

  it('drops traversal paths', () => {
    expect(extractCodeArtifacts('```js path=../../secret.js\nnope\n```')).toEqual([])
  })
})

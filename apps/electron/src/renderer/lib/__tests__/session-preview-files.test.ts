import { expect, test } from 'bun:test'
import { collectSessionPreviewFiles, indexOfPath, siblingsFor } from '../session-preview-files'

test('collects written and mentioned previewable files once, in order', () => {
  const files = collectSessionPreviewFiles([
    { id: '1', role: 'tool', content: '', timestamp: 0, toolName: 'Write', toolInput: { file_path: 'D:/repo/notes.md' } },
    { id: '2', role: 'tool', content: '', timestamp: 0, toolName: 'mcp__x__img', toolResult: '图片已保存：C:/Users/a/Pictures/cat.png\n' },
    { id: '3', role: 'assistant', content: '见 [说明](D:/repo/notes.md) 和 D:/repo/app.zip、D:/repo/src/a.ts。', timestamp: 0 },
  ] as never)
  expect(files).toEqual(['D:/repo/notes.md', 'C:/Users/a/Pictures/cat.png', 'D:/repo/src/a.ts'])
  expect(indexOfPath(String.raw`d:\repo\SRC\a.ts`, files)).toBe(2)
  expect(siblingsFor('D:/other.md', files)[0]).toBe('D:/other.md')
})

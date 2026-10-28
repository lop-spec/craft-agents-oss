/**
 * Files a session produced or mentioned, in first-seen order, for paging in the
 * floating file preview (idea from Cetus artifact-view, MIT; see THIRD_PARTY_NOTICES.md).
 *
 * Sources: file_path / notebook_path / path of write tools, and absolute paths with
 * a previewable extension found in tool results and assistant text.
 */
import { classifyFile } from '@craft-agent/ui/file-classification'
import type { Message } from '../../shared/types'

const WRITE_TOOLS = /^(write|edit|multiedit|notebookedit)$/i
const ABSOLUTE_PATH = /(?:[A-Za-z]:[\\/]|\/)[^\s"'<>|*?()[\]`，。；：、]+\.[A-Za-z0-9]{1,8}/g
const MAX_FILES = 200

const keyOf = (path: string) => path.replaceAll('\\', '/').toLowerCase()

export function collectSessionPreviewFiles(messages: readonly Message[] | undefined): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const add = (raw: unknown) => {
    if (typeof raw !== 'string' || out.length >= MAX_FILES) return
    const path = raw.trim().replace(/[.,;:]+$/, '')
    if (!path || seen.has(keyOf(path)) || !classifyFile(path).canPreview) return
    seen.add(keyOf(path))
    out.push(path)
  }
  for (const m of messages ?? []) {
    if (m.toolName && WRITE_TOOLS.test(m.toolName) && m.toolInput) {
      add(m.toolInput.file_path ?? m.toolInput.notebook_path ?? m.toolInput.path)
    }
    const text = m.role === 'assistant' ? m.content : m.toolResult
    if (typeof text === 'string' && text.length < 200_000) {
      for (const match of text.matchAll(ABSOLUTE_PATH)) add(match[0])
    }
  }
  return out
}

/** Sibling list for the opened file: the session files, with the opened one included. */
export function siblingsFor(path: string, files: string[]): string[] {
  return files.some(f => keyOf(f) === keyOf(path)) ? files : [path, ...files]
}

export function indexOfPath(path: string, files: string[]): number {
  return files.findIndex(f => keyOf(f) === keyOf(path))
}

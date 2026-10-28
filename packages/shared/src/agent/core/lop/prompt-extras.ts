/**
 * Deterministic system-prompt additions from `<config dir>/lop.json`:
 * `promptFiles` (global rules such as ~/.claude/CLAUDE.md) and `memoryIndex`
 * (the MEMORY.md index). Files are read on every prompt build, so edits apply
 * to the next session without a restart; unchanged files keep the prompt
 * byte-identical and cacheable. Missing files are skipped.
 */
import { existsSync, readFileSync } from 'node:fs';
import { getLopConfig } from './config.ts';

const MAX_FILE_CHARS = 60_000;

function readText(file: string): string | null {
  try {
    if (!existsSync(file)) return null;
    const text = readFileSync(file, 'utf-8').replace(/^\uFEFF/, '').trim();
    return text ? text.slice(0, MAX_FILE_CHARS) : null;
  } catch {
    return null;
  }
}

export function getLopPromptAppendix(): string {
  const config = getLopConfig();
  const blocks: string[] = [];
  for (const file of config.promptFiles ?? []) {
    const text = typeof file === 'string' ? readText(file) : null;
    if (text) blocks.push(`<user_rules source="${file}">\n${text}\n</user_rules>`);
  }
  if (typeof config.memoryIndex === 'string') {
    const text = readText(config.memoryIndex);
    if (text) blocks.push(`<memory_index source="${config.memoryIndex}">\n${text}\n</memory_index>`);
  }
  return blocks.length ? `\n\n${blocks.join('\n\n')}\n` : '';
}

/** Whether Craft should ask the model for `_displayName` / `_intent` on tool calls. */
export function toolMetadataEnabled(): boolean {
  return getLopConfig().toolMetadata !== false;
}

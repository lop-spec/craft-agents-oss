/**
 * Machine-local lop settings, read from `<config dir>/lop.json`.
 *
 * Kept outside config.json so Craft's schema migrations never drop it. Every
 * field is optional; a missing or unreadable file disables the features.
 *
 * {
 *   "pretoolRules": "D:/…/rules-pretool.mjs",   // lop-pretool rule module (checkPreTool)
 *   "autoBackup": true,                          // back up files before Write/Edit
 *   "promptFiles": ["C:/Users/lop/.claude/CLAUDE.md"],   // appended to the system prompt
 *   "memoryIndex": "C:/…/memory/MEMORY.md",     // appended to the system prompt
 *   "toolMetadata": false,                       // _displayName/_intent on tool calls
 *   "sharedPromptCacheKey": true                 // Responses: prompt_cache_key = stable prefix hash
 * }
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_DIR } from '../../../config/paths.ts';

export interface LopConfig {
  pretoolRules?: string;
  autoBackup?: boolean;
  promptFiles?: string[];
  memoryIndex?: string;
  toolMetadata?: boolean;
  sharedPromptCacheKey?: boolean;
}

let cached: { mtimeMs: number; config: LopConfig } | null = null;

export function lopConfigPath(): string {
  return join(CONFIG_DIR, 'lop.json');
}

/** Re-read only when the file changes, so callers can use it per tool call. */
export function getLopConfig(): LopConfig {
  const file = lopConfigPath();
  try {
    if (!existsSync(file)) { cached = null; return {}; }
    const mtimeMs = statSync(file).mtimeMs;
    if (cached && cached.mtimeMs === mtimeMs) return cached.config;
    const raw = JSON.parse(readFileSync(file, 'utf-8').replace(/^\uFEFF/, '')) as LopConfig;
    cached = { mtimeMs, config: raw && typeof raw === 'object' ? raw : {} };
    return cached.config;
  } catch {
    return cached?.config ?? {};
  }
}

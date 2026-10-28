/**
 * lop additions around the PreToolUse pipeline (both backends):
 *  1. lop-pretool rules may block a call before any other check.
 *  2. Write/Edit on an existing file is backed up into `_历史版本/` once per
 *     session before the call proceeds; a failed backup blocks the write.
 */
import { isAbsolute, resolve } from 'node:path';
import { autoBackup } from './auto-backup.ts';
import { getLopConfig } from './config.ts';
import { checkLopRules } from './pretool-rules.ts';

export { getLopConfig, lopConfigPath } from './config.ts';
export { lopRulesStatus, preloadLopRules } from './pretool-rules.ts';

const MUTATING_FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);

interface LopCheckInput {
  toolName: string;
  input: Record<string, unknown>;
  sessionId: string;
  workingDirectory?: string;
  workspaceRootPath: string;
}

type Blocked = { type: 'block'; reason: string };

/** Runs before Craft's own checks; returns a block result or null. */
export function lopBeforeChecks(ctx: LopCheckInput): Blocked | null {
  const reason = checkLopRules(ctx.toolName, ctx.input, ctx.sessionId);
  return reason ? { type: 'block', reason } : null;
}

/**
 * Runs once Craft decided to let the call proceed (or ask the user). Backing
 * up before an ask prompt is harmless: the copy only exists, nothing is written.
 */
export function lopAfterChecks(ctx: LopCheckInput, finalInput: Record<string, unknown>): Blocked | null {
  if (!MUTATING_FILE_TOOLS.has(ctx.toolName)) return null;
  if (getLopConfig().autoBackup !== true) return null;
  const raw = typeof finalInput.file_path === 'string' ? finalInput.file_path : typeof finalInput.path === 'string' ? finalInput.path : '';
  if (!raw) return null;
  const abs = isAbsolute(raw) ? raw : resolve(ctx.workingDirectory || ctx.workspaceRootPath, raw);
  try {
    const result = autoBackup(abs, ctx.sessionId);
    if (result.dest) console.error(`[lop-backup] ${abs} -> ${result.dest}`);
    return null;
  } catch (error) {
    return { type: 'block', reason: `写前备份失败，文件尚未修改：${String(error instanceof Error ? error.message : error).slice(0, 200)}` };
  }
}

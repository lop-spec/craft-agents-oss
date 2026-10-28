/**
 * Round-saving tool tweaks, ported from the lop-tool-hints Pi extension.
 * No model calls; each tweak is deterministic and fails open.
 *
 * - grep: a pattern that is not a valid regex is searched as a literal.
 * - read/grep/ls/find: a "path not found" error gets the nearest existing
 *   directory and its closest entries appended.
 * - read: optional `paths` reads up to 7 more known files in the same call.
 */
import { existsSync, readdirSync, type Dirent } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { Type } from '@earendil-works/pi-ai';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';

export const MAX_EXTRA_PATHS = 7;
export const MULTI_READ_MAX_CHARS = 120_000;
export const PATH_TOOLS = new Set(['read', 'grep', 'ls', 'find']);
export const MISSING_PATH = /ENOENT|no such file or directory|Path not found|not found:/i;
const MAX_ITEMS = 12;

/** rg uses Rust regex: only treat a pattern as invalid when JS rejects it in both modes. */
export function isInvalidRegex(pattern: string): boolean {
  const body = pattern.replace(/^\(\?[a-zA-Z]+\)/, '');
  for (const flags of ['', 'u']) {
    try { new RegExp(body, flags); return false; } catch { /* try next */ }
  }
  return true;
}

function score(name: string, wanted: string): number {
  const a = name.toLowerCase(), b = wanted.toLowerCase();
  if (a === b) return 1000;
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  const stem = b.replace(/\.[^.]+$/, '');
  return prefix * 2 + (stem.length >= 3 && a.includes(stem) ? 20 : 0) + (extname(a) && extname(a) === extname(b) ? 3 : 0);
}

/** Hint text for a missing path; empty when no ancestor exists. */
export function missingPathHint(rawPath: string, cwd: string): string {
  const target = resolve(cwd, rawPath.replace(/^@/, ''));
  let dir = dirname(target), wanted = basename(target);
  while (!existsSync(dir)) {
    const parent = dirname(dir);
    if (parent === dir) return '';
    wanted = basename(dir);
    dir = parent;
  }
  let entries: Dirent[];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return ''; }
  const ranked = entries
    .map(entry => ({ name: entry.name + (entry.isDirectory() ? '/' : ''), s: score(entry.name, wanted) }))
    .sort((x, y) => y.s - x.s || y.name.localeCompare(x.name))
    .slice(0, MAX_ITEMS)
    .map(item => item.name);
  return `\n[tool-hints] 最近存在的目录：${dir.replaceAll('\\', '/')}（共 ${entries.length} 项）；与「${wanted}」最相近：${ranked.join(', ') || '(空目录)'}`;
}

/** grep input with `literal: true` when the pattern is not a valid regex; otherwise unchanged. */
export function grepLiteralFallback(input: Record<string, unknown>): Record<string, unknown> {
  if (input.literal || typeof input.pattern !== 'string' || !isInvalidRegex(input.pattern)) return input;
  return { ...input, literal: true };
}

type AnyTool = ToolDefinition<any, any>;

/** Wrap the native read tool with an optional `paths` array for several known files. */
export function withMultiRead(base: AnyTool): AnyTool {
  const parameters = Type.Object({
    ...(base.parameters as { properties: Record<string, unknown> }).properties,
    paths: Type.Optional(Type.Array(Type.String(), {
      maxItems: MAX_EXTRA_PATHS,
      description: `Additional files to read in this same call (up to ${MAX_EXTRA_PATHS}), each from the start with the default limit; offset/limit apply only to path. Use it instead of separate read calls when the files are already known.`,
    })),
  } as never);
  return {
    ...base,
    parameters,
    description: `${base.description} To read several known files at once, list the extra ones in paths.`,
    async execute(id, input, signal, onUpdate, ctx) {
      const { paths, ...first } = (input ?? {}) as Record<string, unknown> & { paths?: unknown };
      const extra = Array.isArray(paths)
        ? [...new Set(paths.filter((p): p is string => typeof p === 'string' && p !== '' && p !== first.path))]
        : [];
      if (!extra.length) return base.execute(id, first as never, signal, onUpdate, ctx);
      const content: Array<{ type: string; text?: string }> = [];
      const skipped: string[] = [];
      let chars = 0, failed = 0, details: unknown;
      const cwd = (ctx as { cwd?: string } | undefined)?.cwd || process.cwd();
      for (const [i, p] of [first.path as string, ...extra].entries()) {
        if (chars >= MULTI_READ_MAX_CHARS) { skipped.push(p); continue; }
        content.push({ type: 'text', text: `=== ${p} ===` });
        try {
          const r = await base.execute(`${id}#${i}`, (i ? { path: p } : first) as never, signal, undefined, ctx);
          if (i === 0) details = r.details;
          for (const c of (r.content ?? []) as Array<{ type: string; text?: string }>) {
            content.push(c);
            if (c.type === 'text' && c.text) chars += c.text.length;
          }
        } catch (error) {
          failed++;
          const message = error instanceof Error ? error.message : String(error);
          content.push({ type: 'text', text: `[读取失败] ${message}${MISSING_PATH.test(message) ? missingPathHint(p, cwd) : ''}` });
        }
      }
      if (skipped.length) content.push({ type: 'text', text: `[未读，合计已超 ${MULTI_READ_MAX_CHARS} 字符] ${skipped.join(', ')}` });
      if (failed === extra.length + 1) throw new Error(content.filter(c => c.type === 'text').map(c => c.text).join('\n'));
      return { content, details } as never;
    },
  };
}

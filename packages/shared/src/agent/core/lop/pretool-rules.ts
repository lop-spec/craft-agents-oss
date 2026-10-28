/**
 * lop-pretool rules inside Craft's PreToolUse pipeline.
 *
 * The rule module (`checkPreTool({ session_id, tool_name, tool_input })` →
 * hits | null) is the same file the Pi extension uses, so there is one source
 * of truth. Rules only allow or block; they never rewrite arguments. A missing
 * or broken module fails open and logs the reason.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { getLopConfig } from './config.ts';

interface RuleHit { id: string; reason?: string; fix?: string }
type CheckPreTool = (ev: { session_id: string; transcript_path: string; tool_name: string; tool_input: unknown }) => RuleHit[] | null;

interface LoadedRules { path: string; sha256: string; check: CheckPreTool }

let loaded: LoadedRules | null = null;
let loading: Promise<void> | null = null;
let lastError = '';

// A literal import() would be rewritten to require() when bundled as CJS; the
// rule file is a standalone ES module outside the bundle.
const nativeImport = new Function('url', 'return import(url)') as (url: string) => Promise<Record<string, unknown>>;

const oneLine = (value: unknown) => String(value).replace(/[\r\n]/g, ' ').slice(0, 200);

function ensureLoading(rulesPath: string): void {
  if (loading || (loaded && loaded.path === rulesPath)) return;
  loading = (async () => {
    try {
      const sha256 = createHash('sha256').update(readFileSync(rulesPath)).digest('hex');
      const mod = await nativeImport(`${pathToFileURL(rulesPath).href}?sha256=${sha256}`);
      if (typeof mod.checkPreTool !== 'function') throw new Error('rules-module-missing-checkPreTool');
      loaded = { path: rulesPath, sha256, check: mod.checkPreTool as CheckPreTool };
      lastError = '';
    } catch (error) {
      lastError = oneLine(error);
      console.error(`[lop-pretool] FAIL_OPEN rules-unavailable reason=${lastError}`);
    } finally {
      loading = null;
    }
  })();
}

/** Start loading as soon as the module is imported so the first tool call is covered. */
export function preloadLopRules(): void {
  const rulesPath = getLopConfig().pretoolRules;
  if (rulesPath) ensureLoading(rulesPath);
}
preloadLopRules();

/**
 * Returns a block reason when a rule hits, otherwise null (also when rules are
 * not configured, still loading, or throw).
 */
export function checkLopRules(toolName: string, input: Record<string, unknown>, sessionId: string): string | null {
  const rulesPath = getLopConfig().pretoolRules;
  if (!rulesPath) return null;
  if (!loaded || loaded.path !== rulesPath) {
    ensureLoading(rulesPath);
    console.error(`[lop-pretool] FAIL_OPEN tool=${oneLine(toolName)} reason=${lastError || 'rules-loading'}`);
    return null;
  }
  try {
    const hits = loaded.check({
      session_id: sessionId,
      transcript_path: '',
      tool_name: toolName,
      // Rule predicates must not be able to mutate the real execution arguments.
      tool_input: structuredClone(input ?? {}),
    });
    if (hits === null || (Array.isArray(hits) && hits.length === 0)) return null;
    if (!Array.isArray(hits)) throw new Error('invalid-rule-result');
    return `lop 安全检查拒绝执行（未改写命令）:${hits.map(h => `${h.reason || h.id}${h.fix ? `;${h.fix}` : ''}`).join(' | ').slice(0, 700)}`;
  } catch (error) {
    console.error(`[lop-pretool] FAIL_OPEN tool=${oneLine(toolName)} reason=${oneLine(error)}`);
    return null;
  }
}

export function lopRulesStatus(): { loaded: boolean; sha256?: string; error?: string } {
  return loaded ? { loaded: true, sha256: loaded.sha256 } : { loaded: false, error: lastError || undefined };
}

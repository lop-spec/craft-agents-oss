import { afterAll, beforeAll, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// CONFIG_DIR is resolved at import time, so point it at a temp dir first.
const root = mkdtempSync(join(tmpdir(), 'lop-test-'));
const configDir = join(root, 'config');
// Backups skip the OS temp dir by design; use a work dir outside it.
const work = join(process.cwd(), '.lop-test-work');
process.env.CRAFT_CONFIG_DIR = configDir;

let lop: typeof import('../index.ts');

beforeAll(async () => {
  mkdirSync(configDir, { recursive: true });
  const rules = join(root, 'rules.mjs');
  writeFileSync(rules, `export function checkPreTool(ev) {
    return ev.tool_name === 'Bash' && /forbidden/.test(ev.tool_input.command) ? [{ id: 'T1', reason: 'blocked by test', fix: 'do not' }] : null;
  }`);
  writeFileSync(join(configDir, 'lop.json'), JSON.stringify({ pretoolRules: rules, autoBackup: true }));
  lop = await import('../index.ts');
  lop.preloadLopRules();
  for (let i = 0; i < 50 && !lop.lopRulesStatus().loaded; i++) await new Promise(r => setTimeout(r, 20));
  mkdirSync(join(work, '_历史版本'), { recursive: true });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(work, { recursive: true, force: true });
});

const ctx = (toolName: string, input: Record<string, unknown>) => ({ toolName, input, sessionId: 's1', workspaceRootPath: work });

test('rules block a matching Bash call', () => {
  expect(lop.lopRulesStatus().loaded).toBe(true);
  const blocked = lop.lopBeforeChecks(ctx('Bash', { command: 'echo forbidden' }));
  expect(blocked?.type).toBe('block');
  expect(blocked?.reason).toContain('blocked by test;do not');
  expect(lop.lopBeforeChecks(ctx('Bash', { command: 'echo ok' }))).toBeNull();
});

test('existing file is backed up once per session before Edit', () => {
  const file = join(work, 'a.txt');
  writeFileSync(file, 'v1');
  expect(lop.lopAfterChecks(ctx('Edit', { file_path: file }), { file_path: file })).toBeNull();
  expect(lop.lopAfterChecks(ctx('Edit', { file_path: file }), { file_path: file })).toBeNull();
  const backups = readdirSync(join(work, '_历史版本'));
  expect(backups.length).toBe(1);
  expect(readFileSync(join(work, '_历史版本', backups[0]!), 'utf-8')).toBe('v1');
});

test('new files and read-only tools are not backed up', () => {
  const file = join(work, 'new.txt');
  expect(lop.lopAfterChecks(ctx('Write', { file_path: file }), { file_path: file })).toBeNull();
  expect(lop.lopAfterChecks(ctx('Read', { file_path: file }), { file_path: file })).toBeNull();
  expect(existsSync(join(work, '_历史版本', 'new.txt'))).toBe(false);
});

import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { grepLiteralFallback, isInvalidRegex, missingPathHint, withMultiRead } from './lop-tool-hints.ts';

const root = mkdtempSync(join(tmpdir(), 'tool-hints-'));
mkdirSync(join(root, 'src'));
writeFileSync(join(root, 'src', 'session-settings.ts'), 'x');
writeFileSync(join(root, 'src', 'other.ts'), 'y');
afterAll(() => rmSync(root, { recursive: true, force: true }));

test('invalid regex falls back to literal; valid regex untouched', () => {
  expect(isInvalidRegex('foo(')).toBe(true);
  expect(isInvalidRegex('(?i)foo')).toBe(false);
  expect(grepLiteralFallback({ pattern: 'a[b' })).toEqual({ pattern: 'a[b', literal: true });
  expect(grepLiteralFallback({ pattern: 'a.b' })).toEqual({ pattern: 'a.b' });
});

test('missing path hint ranks the closest entry first', () => {
  const hint = missingPathHint('src/session-setting.ts', root);
  expect(hint).toContain('session-settings.ts');
  expect(hint.indexOf('session-settings.ts')).toBeLessThan(hint.indexOf('other.ts'));
  expect(missingPathHint('nope/deeper/file.ts', root)).toContain('最近存在的目录');
});

test('multi-read concatenates files and keeps single reads native', async () => {
  const calls: unknown[] = [];
  const base = {
    name: 'read', label: 'read', description: 'Read a file.',
    parameters: { type: 'object', properties: { path: { type: 'string' } } },
    async execute(_id: string, input: { path: string }) {
      calls.push(input);
      if (input.path === 'missing.txt') throw new Error('ENOENT: no such file or directory');
      return { content: [{ type: 'text', text: `content of ${input.path}` }], details: undefined };
    },
  } as never;
  const tool = withMultiRead(base);
  const single = await tool.execute('1', { path: 'a.txt' } as never, undefined, undefined, undefined as never);
  expect((single.content as Array<{ text: string }>)[0]!.text).toBe('content of a.txt');
  const multi = await tool.execute('2', { path: 'a.txt', paths: ['b.txt', 'missing.txt'] } as never, undefined, undefined, { cwd: root } as never);
  const text = (multi.content as Array<{ text?: string }>).map(c => c.text).join('\n');
  expect(text).toContain('content of b.txt');
  expect(text).toContain('[读取失败]');
  expect(calls.length).toBe(4);
});

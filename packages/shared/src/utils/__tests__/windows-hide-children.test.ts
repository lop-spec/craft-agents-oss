import { withWindowsHide } from '../windows-hide-children.ts';
import { test, expect } from 'bun:test';
test('spawn no opts', () => expect(withWindowsHide(['git', ['status']], 1)).toEqual(['git', ['status'], { windowsHide: true }]));
test('spawn opts', () => expect(withWindowsHide(['git', ['s'], { cwd: 'x' }], 1)).toEqual(['git', ['s'], { cwd: 'x', windowsHide: true }]));
test('explicit false kept', () => expect(withWindowsHide(['git', { windowsHide: false }], 1)[1]).toEqual({ windowsHide: false }));
test('exec cb', () => { const cb = () => {}; expect(withWindowsHide(['ls', cb], 1)).toEqual(['ls', { windowsHide: true }, cb]); });
test('execFile args cb', () => { const cb = () => {}; expect(withWindowsHide(['f', ['a'], cb], 1)).toEqual(['f', ['a'], { windowsHide: true }, cb]); });
test('null opts', () => expect(withWindowsHide(['ls', null], 1)).toEqual(['ls', { windowsHide: true }]));

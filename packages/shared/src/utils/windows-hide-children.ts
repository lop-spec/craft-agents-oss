/**
 * Default every child process to `windowsHide: true` on Windows.
 *
 * Console programs started without it (git status polling, ripgrep, shell
 * probes, third-party SDK helpers) each get a console window. When Windows
 * Terminal is the default terminal that window is a real, focus-stealing
 * Terminal tab that flashes on every call. Patching the exported functions of
 * `node:child_process` covers Craft's own call sites and its dependencies in
 * the same process; an explicit `windowsHide: false` is left untouched.
 *
 * Install as early as possible in every process entry (Electron main, the Pi
 * subprocess via the network interceptor, the headless server).
 */
import childProcess from 'node:child_process';
import * as nodeModule from 'node:module';

const INSTALLED = Symbol.for('craft.windowsHideChildren');

type AnyFn = (...args: unknown[]) => unknown;

function isPlainOptions(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Return a copy of `args` whose options object (searched from `from`, skipping
 * an argv array) carries `windowsHide: true` unless already set.
 */
export function withWindowsHide(args: unknown[], from: number): unknown[] {
  const out = [...args];
  for (let i = from; i < out.length; i++) {
    const value = out[i];
    if (Array.isArray(value)) continue;
    if (typeof value === 'function') {
      out.splice(i, 0, { windowsHide: true });
      return out;
    }
    if (value === undefined || value === null) {
      out[i] = { windowsHide: true };
      return out;
    }
    if (isPlainOptions(value)) {
      if (value.windowsHide === undefined) out[i] = { ...value, windowsHide: true };
      return out;
    }
    return out;
  }
  out.push({ windowsHide: true });
  return out;
}

export function installWindowsHideChildren(): void {
  if (process.platform !== 'win32') return;
  const flags = globalThis as Record<symbol, unknown>;
  if (flags[INSTALLED]) return;
  flags[INSTALLED] = true;

  // Default import = the mutable CommonJS module object in both the CJS main
  // bundle and ESM subprocesses, so patched properties are seen by every caller
  // that resolves child_process functions at call time.
  const cp = childProcess as unknown as Record<string, AnyFn>;
  // Index of the first argument after the program/command.
  const optionStart: Record<string, number> = {
    spawn: 1, spawnSync: 1, execFile: 1, execFileSync: 1, exec: 1, execSync: 1, fork: 1,
  };
  for (const [name, from] of Object.entries(optionStart)) {
    const original = cp[name];
    if (typeof original !== 'function') continue;
    const patched = function (this: unknown, ...args: unknown[]) {
      return original.apply(this, withWindowsHide(args, from));
    };
    // Keep util.promisify(exec/execFile) returning { stdout, stderr }.
    for (const key of Object.getOwnPropertySymbols(original)) {
      (patched as unknown as Record<symbol, unknown>)[key] = (original as unknown as Record<symbol, unknown>)[key];
    }
    try { cp[name] = patched; } catch { /* frozen module: leave as is */ }
  }
  try { (nodeModule as { syncBuiltinESMExports?: () => void }).syncBuiltinESMExports?.(); } catch { /* bun */ }
}

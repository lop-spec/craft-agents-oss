/**
 * Shell Environment Loader
 *
 * When Electron apps are launched from Finder/Dock on macOS, they inherit
 * a minimal launchd environment with PATH=/usr/bin:/bin:/usr/sbin:/sbin.
 *
 * This module loads the user's full shell environment by spawning their
 * login shell and extracting environment variables. This ensures tools
 * like Homebrew (gh, brew), nvm, pyenv, etc. are available to the agent.
 */

import { execSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { delimiter, join } from 'path'
import { mainLog } from './logger'

// Environment variables that should NOT be imported from the shell
// VITE_* vars from dev mode would make packaged app try to load from localhost
const shouldSkipEnvVar = (key: string): boolean => {
  return key.startsWith('VITE_')
}

/**
 * Load the user's shell environment and merge it into process.env
 *
 * This should be called early in app startup, before creating any agents.
 * It spawns the user's login shell to get the full environment including
 * PATH modifications from .zshrc, .bashrc, .zprofile, etc.
 */
export function loadShellEnv(): void {
  // Only needed on macOS where GUI apps have minimal environment
  if (process.platform !== 'darwin') {
    return
  }

  // Skip in dev mode - terminal launches already have full environment
  if (process.env.VITE_DEV_SERVER_URL) {
    mainLog.info('[shell-env] Skipping in dev mode (already have shell environment)')
    return
  }

  const shell = process.env.SHELL || '/bin/zsh'
  mainLog.info(`[shell-env] Loading environment from ${shell}`)

  try {
    // Run login shell to get full environment
    // -l = login shell (sources profile files like .zprofile)
    // -i = interactive shell (sources rc files like .zshrc)
    // We use a marker to separate shell startup output from env output
    const output = execSync(`${shell} -l -i -c 'echo __ENV_START__ && env'`, {
      encoding: 'utf-8',
      timeout: 5000,
      env: {
        HOME: process.env.HOME,
        USER: process.env.USER,
        SHELL: shell,
        TERM: 'xterm-256color',
        TMPDIR: process.env.TMPDIR,
        // Prevent macOS from showing "Install Command Line Developer Tools" dialog
        // when the shell hits the /usr/bin/git shim on systems without Xcode CLT
        APPLE_SUPPRESS_DEVELOPER_TOOL_POPUP: '1',
        GIT_TERMINAL_PROMPT: '0',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    // Parse environment after marker and set variables (excluding blocked ones)
    const envSection = output.split('__ENV_START__')[1] || ''
    let count = 0
    for (const line of envSection.trim().split('\n')) {
      const eq = line.indexOf('=')
      if (eq > 0) {
        const key = line.substring(0, eq)
        if (shouldSkipEnvVar(key)) continue
        const value = line.substring(eq + 1)
        process.env[key] = value
        count++
      }
    }

    mainLog.info(`[shell-env] Loaded ${count} environment variables`)

    // Log PATH for debugging
    if (process.env.PATH) {
      const pathCount = process.env.PATH.split(':').length
      mainLog.info(`[shell-env] PATH has ${pathCount} entries`)
    }
  } catch (error) {
    // Don't fail app startup if shell env loading fails
    mainLog.warn(`[shell-env] Failed to load shell environment: ${error}`)
    mainLog.warn('[shell-env] Adding common paths as fallback')

    // Fallback: add common paths that are likely to be needed
    const fallbackPaths = [
      '/opt/homebrew/bin',
      '/opt/homebrew/sbin',
      '/usr/local/bin',
      '/usr/local/sbin',
      `${process.env.HOME}/.local/bin`,
      `${process.env.HOME}/.bun/bin`,
      `${process.env.HOME}/.cargo/bin`,
    ]

    const currentPath = process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin'
    const newPath = [...fallbackPaths, ...currentPath.split(':')]
      .filter((p, i, arr) => arr.indexOf(p) === i) // dedupe
      .join(':')

    process.env.PATH = newPath
  }
}

/**
 * Prepend user-configured tool directories (e.g. a portable Python or Node) to
 * PATH so every agent backend and tool subprocess can find them.
 *
 * Reads `<config dir>/toolchain.json`: `{ "paths": ["C:\tools\python", ...] }`.
 * Kept out of config.json so schema migrations never drop it. Missing file or
 * missing directories are ignored.
 */
export function applyToolchainPath(): void {
  try {
    const configDir = process.env.CRAFT_CONFIG_DIR?.trim() || join(homedir(), '.craft-agent')
    const file = join(configDir, 'toolchain.json')
    if (!existsSync(file)) return
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as { paths?: unknown }
    const dirs = Array.isArray(parsed.paths)
      ? parsed.paths.filter((p): p is string => typeof p === 'string' && p.trim() !== '' && existsSync(p))
      : []
    if (dirs.length === 0) return
    // Windows env keys are case-insensitive; reuse the existing spelling (usually "Path").
    const key = Object.keys(process.env).find(k => k.toUpperCase() === 'PATH') ?? 'PATH'
    const current = (process.env[key] ?? '').split(delimiter).filter(Boolean)
    const lower = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p)
    const existing = new Set(current.map(lower))
    process.env[key] = [...dirs.filter(d => !existing.has(lower(d))), ...current].join(delimiter)
    mainLog.info(`[shell-env] Toolchain paths prepended: ${dirs.join(', ')}`)
  } catch (error) {
    mainLog.warn(`[shell-env] Ignoring toolchain.json: ${error instanceof Error ? error.message : String(error)}`)
  }
}

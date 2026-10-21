import os from 'node:os'
import path from 'node:path'
import { type Lang, isLang } from '../shared/i18n.ts'

export function claudeDir(): string {
  return process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude')
}

export function projectsDir(): string {
  return path.join(claudeDir(), 'projects')
}

/** One small JSON file per running Claude Code process. */
export function liveSessionsDir(): string {
  return path.join(claudeDir(), 'sessions')
}

/**
 * Session metadata written by the Claude desktop app (title, branch, worktree, archive state).
 * Only the macOS location has been verified; the others follow Electron's userData conventions.
 */
export function desktopSessionsDir(): string | null {
  if (process.env.WIENER_DESKTOP_DIR) return process.env.WIENER_DESKTOP_DIR
  const home = os.homedir()
  switch (process.platform) {
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', 'Claude', 'claude-code-sessions')
    case 'win32':
      return process.env.APPDATA ? path.join(process.env.APPDATA, 'Claude', 'claude-code-sessions') : null
    default:
      return path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'Claude', 'claude-code-sessions')
  }
}

/**
 * Where this tool keeps its own index and settings. Never inside ~/.claude. Each Wiener Tools
 * package gets its own folder under ~/.wiener-tools, so they never share files.
 */
export function dataDir(): string {
  return process.env.WIENER_DATA_DIR ?? path.join(os.homedir(), '.wiener-tools', 'claude')
}

/** The terminal's language: WIENER_LANG if set, else the locale variables; Turkish or English. */
export function terminalLang(): Lang {
  const set = process.env.WIENER_LANG
  if (isLang(set)) return set
  const locale = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || ''
  return locale.toLowerCase().startsWith('tr') ? 'tr' : 'en'
}

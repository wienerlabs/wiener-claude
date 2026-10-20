import os from 'node:os'
import path from 'node:path'

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

/** Where Wiener Tools keeps its own index and settings. Never inside ~/.claude. */
export function dataDir(): string {
  return process.env.WIENER_DATA_DIR ?? path.join(os.homedir(), '.wiener-tools')
}

import path from 'node:path'

export const SCRATCH_PROJECT_KEY = 'scratch'
export const SCRATCH_PROJECT_NAME = 'Klasörsüz oturumlar'

/**
 * Groups a working directory under the project it belongs to. Worktrees count toward their
 * repository, and the desktop app's per-session scratch folders share one bucket.
 */
export function projectOf(cwd: string | null, slug: string | null): { key: string; name: string } {
  if (!cwd) {
    const name = slug ? slug.replace(/^-+/, '').split('-').filter(Boolean).pop() ?? slug : 'Bilinmeyen'
    return { key: `slug:${slug ?? 'unknown'}`, name }
  }
  const p = cwd.replace(/\\/g, '/').replace(/\/+$/, '')
  if (p.includes('/scratch-workspaces/')) return { key: SCRATCH_PROJECT_KEY, name: SCRATCH_PROJECT_NAME }
  const wt = p.indexOf('/.claude/worktrees/')
  const root = wt >= 0 ? p.slice(0, wt) : p
  return { key: root, name: path.posix.basename(root) || root }
}

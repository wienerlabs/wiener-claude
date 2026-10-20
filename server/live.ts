import fs from 'node:fs/promises'
import path from 'node:path'
import type { LiveSession } from '../shared/types.ts'
import type { Db } from './db.ts'
import { liveSessionsDir } from './paths.ts'
import { parseTs } from './parse.ts'

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM: the process exists but belongs to someone else.
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Claude Code processes running right now, from ~/.claude/sessions/<pid>.json. */
export async function liveSessions(db: Db): Promise<LiveSession[]> {
  const dir = liveSessionsDir()
  let names: string[]
  try {
    names = (await fs.readdir(dir)).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }
  const title = db.prepare(`SELECT COALESCE(NULLIF(s.custom_title, ''), NULLIF(d.title, ''), NULLIF(s.ai_title, ''), s.first_prompt) AS title,
      s.project_name AS project FROM sessions s LEFT JOIN desktop_sessions d ON d.cli_session_id = s.id WHERE s.id = ?`)
  const out: LiveSession[] = []
  for (const name of names) {
    try {
      const o = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')) as Record<string, unknown>
      const pid = typeof o.pid === 'number' ? o.pid : Number(path.basename(name, '.json'))
      const sessionId = typeof o.sessionId === 'string' ? o.sessionId : null
      if (!sessionId || !Number.isInteger(pid) || !isAlive(pid)) continue
      const meta = title.get(sessionId) as { title: string | null; project: string | null } | undefined
      out.push({
        sessionId,
        pid,
        cwd: typeof o.cwd === 'string' ? o.cwd : null,
        projectName: meta?.project ?? null,
        title: meta?.title ?? (typeof o.name === 'string' ? o.name : null),
        status: typeof o.status === 'string' ? o.status : null,
        updatedAt: parseTs(o.updatedAt) ?? parseTs(o.statusUpdatedAt),
      })
    } catch {
      // Being written or already gone.
    }
  }
  return out.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
}

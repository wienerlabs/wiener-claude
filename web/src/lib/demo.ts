// The public demo build answers API requests from recorded files (see scripts/demo). Lists and
// transcripts were recorded whole; paging and search over them happen here.
import { demoFile } from '../../../shared/demo.ts'
import type { ReplayPage, SessionList } from '../../../shared/types.ts'

export const DEMO = import.meta.env.MODE === 'demo'

const fold = (s: string) => s.toLocaleLowerCase('tr').replace(/ı/g, 'i').normalize('NFD').replace(/\p{M}/gu, '')

async function recorded<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`/demo-api/${demoFile(url)}`, { signal })
  if (!res.ok) throw new Error("Bu görünüm demoda yok. Kendi verinle denemek için: npx wiener-tools-claude")
  return (await res.json()) as T
}

export async function demoJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const u = new URL(path, location.origin)
  const session = u.pathname.match(/^\/api\/sessions\/([^/]+)$/)
  if (session) {
    const page = await recorded<ReplayPage>(u.pathname, signal)
    // A search hit's position isn't recorded; such links open at the start.
    const from = Number(u.searchParams.get('from') ?? 0) || 0
    const limit = Number(u.searchParams.get('limit') ?? 25) || 25
    return { ...page, from, focusTurn: null, turns: page.turns.slice(from, from + limit) } as T
  }
  if (u.pathname === '/api/sessions') {
    const limit = Number(u.searchParams.get('limit') ?? 50) || 50
    const q = u.searchParams.get('q')
    for (const k of ['limit', 'offset', 'q']) u.searchParams.delete(k)
    const list = await recorded<SessionList>(`${u.pathname}${u.search}`, signal)
    // Full-text search needs the index; the demo matches titles and project names.
    const rows = q ? list.rows.filter((r) => fold(`${r.title} ${r.projectName}`).includes(fold(q))) : list.rows
    return { ...list, rows: rows.slice(0, limit), total: rows.length } as T
  }
  return recorded<T>(`${u.pathname}${u.search}`, signal)
}

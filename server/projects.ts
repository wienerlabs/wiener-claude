import os from 'node:os'
import type { ProjectDetail, ProjectFile, ProjectSummary } from '../shared/types.ts'
import type { Db } from './db.ts'
import { normalizeModel } from './pricing.ts'
import { addDays, today } from './time.ts'

type Row = Record<string, unknown>
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

const STRIP_DAYS = 84
const TITLE = `COALESCE(NULLIF(s.custom_title, ''), NULLIF(d.title, ''), NULLIF(s.ai_title, ''), NULLIF(s.first_prompt, ''), 'Adsız oturum')`

/** Project keys are repository roots, except the shared scratch bucket and slug fallbacks. */
const rootOf = (key: string) => (key.startsWith('/') || /^[A-Za-z]:\//.test(key) ? key : null)

/** A path inside the project shown relative to it; anything else shortened to ~. */
export function displayPath(p: string, root: string | null): string {
  if (root && p.startsWith(`${root}/`)) return p.slice(root.length + 1)
  const home = os.homedir()
  return p.startsWith(`${home}/`) ? `~/${p.slice(home.length + 1)}` : p
}

const inProject = 'session_id IN (SELECT id FROM sessions WHERE project_key = $key)'

function files(db: Db, key: string, limit: number): ProjectFile[] {
  const root = rootOf(key)
  return (db.prepare(`SELECT path, count(*) AS edits, sum(added) AS added, sum(removed) AS removed, max(ts) AS last_ts,
      count(DISTINCT session_id) AS sessions
    FROM file_edits WHERE ${inProject} GROUP BY path ORDER BY edits DESC, last_ts DESC LIMIT $limit`)
    .all({ $key: key, $limit: limit }) as Row[]).map((r) => ({
    path: displayPath(String(r.path), root),
    edits: n(r.edits), added: n(r.added), removed: n(r.removed), lastTs: n(r.last_ts), sessions: n(r.sessions),
  }))
}

export function projectList(db: Db): ProjectSummary[] {
  const t = today()
  const from30 = addDays(t, -29)
  const stripFrom = addDays(t, -(STRIP_DAYS - 1))
  const base = db.prepare(`SELECT s.project_key AS key, s.project_name AS name, count(*) AS sessions,
      min(s.first_ts) AS first_ts, max(s.last_ts) AS last_ts
    FROM sessions s WHERE s.first_ts IS NOT NULL AND s.project_key IS NOT NULL
    GROUP BY s.project_key ORDER BY last_ts DESC`).all() as Row[]

  const costs = new Map(
    (db.prepare(`SELECT s.project_key AS key, sum(a.cost) AS cost, sum(CASE WHEN a.day >= ? THEN a.cost ELSE 0 END) AS cost30
      FROM api_calls a JOIN sessions s ON s.id = a.session_id GROUP BY s.project_key`).all(from30) as Row[]).map((r) => [String(r.key), r]),
  )
  const daily = db.prepare(`SELECT s.project_key AS key, f.day AS day, count(*) AS c FROM (
      SELECT session_id, day FROM prompts WHERE day >= ?1
      UNION ALL SELECT session_id, day FROM api_calls WHERE is_sidechain = 0 AND day >= ?1
    ) f JOIN sessions s ON s.id = f.session_id GROUP BY s.project_key, f.day`).all(stripFrom) as Row[]
  const strips = new Map<string, number[]>()
  const dayIndex = (day: string) => Math.round((Date.parse(`${day}T12:00:00`) - Date.parse(`${stripFrom}T12:00:00`)) / 86_400_000)
  for (const r of daily) {
    const key = String(r.key)
    const strip = strips.get(key) ?? new Array<number>(STRIP_DAYS).fill(0)
    const i = dayIndex(String(r.day))
    if (i >= 0 && i < STRIP_DAYS) strip[i] = n(r.c)
    strips.set(key, strip)
  }

  return base.map((r) => {
    const key = String(r.key)
    const strip = strips.get(key) ?? new Array<number>(STRIP_DAYS).fill(0)
    return {
      key,
      name: String(r.name),
      path: rootOf(key),
      sessions: n(r.sessions),
      firstTs: n(r.first_ts),
      lastTs: n(r.last_ts),
      cost: n(costs.get(key)?.cost),
      cost30: n(costs.get(key)?.cost30),
      messages30: strip.slice(-30).reduce((s, v) => s + v, 0),
      strip,
      topFiles: files(db, key, 3).map((f) => f.path),
    }
  })
}

export function projectDetail(db: Db, key: string): ProjectDetail | null {
  const summary = projectList(db).find((p) => p.key === key)
  if (!summary) return null
  const p = { $key: key }
  const counts = db.prepare(`SELECT
      (SELECT count(*) FROM prompts WHERE ${inProject}) AS prompts,
      (SELECT count(*) FROM api_calls WHERE is_sidechain = 0 AND ${inProject}) AS replies,
      (SELECT count(*) FROM tool_uses WHERE name IS NOT NULL AND ${inProject}) AS tool_calls,
      (SELECT count(*) FROM tool_uses WHERE is_error = 1 AND denied IS NULL AND ${inProject}) AS tool_errors,
      (SELECT COALESCE(sum(added), 0) FROM file_edits WHERE ${inProject}) AS added,
      (SELECT COALESCE(sum(removed), 0) FROM file_edits WHERE ${inProject}) AS removed`).get(p) as Row

  const prs = (db.prepare(`SELECT pr.url, pr.number, pr.repo, pr.ts, pr.session_id, ${TITLE} AS title
      FROM prs pr JOIN sessions s ON s.id = pr.session_id LEFT JOIN desktop_sessions d ON d.cli_session_id = s.id
      WHERE s.project_key = $key ORDER BY pr.ts DESC LIMIT 30`).all(p) as Row[]).map((r) => ({
    url: String(r.url), number: typeof r.number === 'number' ? r.number : null, repo: (r.repo as string | null) ?? null,
    ts: n(r.ts), sessionId: String(r.session_id), title: String(r.title),
  }))

  const tools = (db.prepare(`SELECT name, count(*) AS calls, sum(CASE WHEN is_error = 1 AND denied IS NULL THEN 1 ELSE 0 END) AS errors
      FROM tool_uses WHERE name IS NOT NULL AND ${inProject} GROUP BY name ORDER BY calls DESC LIMIT 12`).all(p) as Row[]).map((r) => ({
    name: String(r.name), calls: n(r.calls), errors: n(r.errors),
  }))

  const byModel = new Map<string, number>()
  for (const r of db.prepare(`SELECT model, sum(cost) AS cost FROM api_calls WHERE ${inProject} GROUP BY model`).all(p) as Row[]) {
    const m = normalizeModel(String(r.model))
    byModel.set(m, (byModel.get(m) ?? 0) + n(r.cost))
  }

  return {
    ...summary,
    prompts: n(counts.prompts),
    messages: n(counts.prompts) + n(counts.replies),
    toolCalls: n(counts.tool_calls),
    toolErrors: n(counts.tool_errors),
    linesAdded: n(counts.added),
    linesRemoved: n(counts.removed),
    files: files(db, key, 30),
    prs,
    tools,
    models: [...byModel].map(([model, cost]) => ({ model, cost })).sort((a, b) => b.cost - a.cost),
  }
}

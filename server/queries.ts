import type {
  DayDetail, HeatmapResponse, HeatmapView, Insight, Metric, ProjectOption, SessionList, SessionRow, SessionSource, Summary,
} from '../shared/types.ts'
import type { Db } from './db.ts'
import { withPossessive } from '../shared/tr.ts'
import { addDays, today, weekStart } from './time.ts'

type Row = Record<string, unknown>
const all = (db: Db, sql: string, ...params: (string | number | null)[]) => db.prepare(sql).all(...params) as Row[]
const one = (db: Db, sql: string, ...params: (string | number | null)[]) => db.prepare(sql).get(...params) as Row | undefined
const n = (v: unknown) => (typeof v === 'number' ? v : 0)

/** Idle gaps longer than this between two events don't count as active time. */
const IDLE_GAP_MS = 10 * 60_000

// One row per counted occurrence, with the day/hour/weekday it fell on.
const FACTS: Record<Metric, string> = {
  messages: `SELECT day, hour, dow, session_id, 1 AS v FROM prompts WHERE day BETWEEN $from AND $to
    UNION ALL SELECT day, hour, dow, session_id, 1 FROM api_calls WHERE is_sidechain = 0 AND day BETWEEN $from AND $to`,
  tokens: `SELECT day, hour, dow, session_id, input + output + cache_write_5m + cache_write_1h AS v
    FROM api_calls WHERE day BETWEEN $from AND $to`,
  cost: `SELECT day, hour, dow, session_id, COALESCE(cost, 0) AS v FROM api_calls WHERE day BETWEEN $from AND $to`,
  sessions: `SELECT day, hour, dow, session_id, 1 AS v FROM prompts WHERE day BETWEEN $from AND $to
    UNION ALL SELECT day, hour, dow, session_id, 1 FROM api_calls WHERE is_sidechain = 0 AND day BETWEEN $from AND $to`,
  errors: `SELECT day, hour, dow, session_id, 1 AS v FROM tool_uses
      WHERE is_error = 1 AND denied IS NULL AND day BETWEEN $from AND $to
    UNION ALL SELECT day, hour, dow, session_id, 1 FROM events WHERE kind = 'api_error' AND day BETWEEN $from AND $to`,
}

export const METRICS: Metric[] = ['messages', 'tokens', 'cost', 'sessions', 'errors']
export const VIEWS: HeatmapView[] = ['calendar', 'weekhour', 'project']

/** Default window per view: a year of days, a quarter of weekday-hours, a month of projects. */
export function defaultRange(view: HeatmapView): { from: string; to: string } {
  const to = today()
  const days = view === 'calendar' ? 52 * 7 + 6 : view === 'weekhour' ? 89 : 29
  return { from: addDays(to, -days), to }
}

const PROJECT_ROWS = 10

export function heatmap(db: Db, view: HeatmapView, metric: Metric, from: string, to: string): HeatmapResponse {
  const agg = metric === 'sessions' ? 'COUNT(DISTINCT f.session_id)' : 'SUM(f.v)'
  const facts = FACTS[metric]
  const params = { $from: from, $to: to }
  let cells: { key: string; value: number }[]
  let projects: HeatmapResponse['projects'] = []

  if (view === 'project') {
    const totals = db
      .prepare(`WITH f AS (${facts})
        SELECT COALESCE(s.project_key, '?') AS key, COALESCE(s.project_name, 'Bilinmeyen') AS name, ${agg} AS total
        FROM f LEFT JOIN sessions s ON s.id = f.session_id GROUP BY key ORDER BY total DESC`)
      .all(params) as { key: string; name: string; total: number }[]
    const top = totals.slice(0, PROJECT_ROWS)
    const rest = totals.slice(PROJECT_ROWS)
    projects = top.map((p) => ({ key: p.key, name: p.name, total: n(p.total) }))
    const topKeys = new Set(top.map((p) => p.key))
    const raw = db
      .prepare(`WITH f AS (${facts})
        SELECT COALESCE(s.project_key, '?') AS pkey, f.day AS day, ${agg} AS value
        FROM f LEFT JOIN sessions s ON s.id = f.session_id GROUP BY pkey, f.day`)
      .all(params) as { pkey: string; day: string; value: number }[]
    cells = []
    const other = new Map<string, number>()
    for (const r of raw) {
      if (topKeys.has(r.pkey)) cells.push({ key: `${r.pkey}|${r.day}`, value: n(r.value) })
      else other.set(r.day, (other.get(r.day) ?? 0) + n(r.value))
    }
    if (rest.length > 0) {
      // Distinct-session counts can't be summed across projects exactly; the sum is an upper bound.
      projects.push({ key: '__other__', name: `Diğer ${rest.length} proje`, total: rest.reduce((s, p) => s + n(p.total), 0) })
      for (const [day, value] of other) cells.push({ key: `__other__|${day}`, value })
    }
  } else {
    const bucket = view === 'calendar' ? 'f.day' : "f.dow || ':' || f.hour"
    cells = (db.prepare(`WITH f AS (${facts}) SELECT ${bucket} AS key, ${agg} AS value FROM f GROUP BY key`).all(params) as {
      key: string
      value: number
    }[]).map((c) => ({ key: String(c.key), value: n(c.value) }))
  }

  const totalRow = db.prepare(`WITH f AS (${facts}) SELECT ${agg} AS total FROM f`).get(params) as { total: number }
  return {
    view, metric, from, to, cells, projects,
    max: cells.reduce((m, c) => Math.max(m, c.value), 0),
    total: n(totalRow?.total),
  }
}

function messagesOn(db: Db, from: string, to: string): number {
  const r = one(db, `SELECT (SELECT count(*) FROM prompts WHERE day BETWEEN ?1 AND ?2)
    + (SELECT count(*) FROM api_calls WHERE is_sidechain = 0 AND day BETWEEN ?1 AND ?2) AS c`, from, to)
  return n(r?.c)
}

function costBetween(db: Db, from: string, to: string): number {
  return n(one(db, 'SELECT COALESCE(sum(cost), 0) AS c FROM api_calls WHERE day BETWEEN ? AND ?', from, to)?.c)
}

export function summary(db: Db, live: Summary['live']): Summary {
  const t = today()
  const ws = weekStart(t)
  const elapsed = Math.round((Date.parse(`${t}T12:00:00`) - Date.parse(`${ws}T12:00:00`)) / 86_400_000)
  const lastWs = addDays(ws, -7)

  const days = all(db, 'SELECT DISTINCT day FROM prompts ORDER BY day').map((r) => String(r.day))
  const active = new Set(days)
  let longest = 0
  let run = 0
  let prev: string | null = null
  for (const d of days) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1
    longest = Math.max(longest, run)
    prev = d
  }
  let current = 0
  for (let d = active.has(t) ? t : addDays(t, -1); active.has(d); d = addDays(d, -1)) current++

  const totals = one(db, 'SELECT count(*) AS c, min(first_ts) AS f FROM sessions WHERE first_ts IS NOT NULL')
  const firstDay = days[0] ?? null
  return {
    today: { messages: messagesOn(db, t, t), yesterdayMessages: messagesOn(db, addDays(t, -1), addDays(t, -1)) },
    week: { cost: costBetween(db, ws, t), lastWeekCost: costBetween(db, lastWs, addDays(lastWs, elapsed)) },
    live,
    streak: { current, longest, activeToday: active.has(t) },
    totals: { sessions: n(totals?.c), firstDay },
  }
}

const TITLE = `COALESCE(NULLIF(s.custom_title, ''), NULLIF(d.title, ''), NULLIF(s.ai_title, ''), NULLIF(s.first_prompt, ''), 'Adsız oturum')`

export function day(db: Db, dayKey: string): DayDetail {
  const rows = all(db, `
    WITH f AS (
      SELECT session_id, ts, 1 AS msg, 0 AS cost, 0 AS err FROM prompts WHERE day = ?1
      UNION ALL SELECT session_id, ts, 1 - is_sidechain, COALESCE(cost, 0), 0 FROM api_calls WHERE day = ?1
      UNION ALL SELECT session_id, ts, 0, 0, 1 FROM tool_uses WHERE day = ?1 AND is_error = 1 AND denied IS NULL
      UNION ALL SELECT session_id, ts, 0, 0, 1 FROM events WHERE day = ?1 AND kind = 'api_error'
    )
    SELECT f.session_id AS id, ${TITLE} AS title, COALESCE(s.project_name, 'Bilinmeyen') AS project,
      min(f.ts) AS first_ts, max(f.ts) AS last_ts, sum(f.msg) AS messages, sum(f.cost) AS cost, sum(f.err) AS errors
    FROM f LEFT JOIN sessions s ON s.id = f.session_id LEFT JOIN desktop_sessions d ON d.cli_session_id = f.session_id
    GROUP BY f.session_id ORDER BY first_ts`, dayKey)
  const sessions = rows.map((r) => ({
    id: String(r.id), title: String(r.title), projectName: String(r.project),
    firstTs: n(r.first_ts), lastTs: n(r.last_ts), messages: n(r.messages), cost: n(r.cost), errors: n(r.errors),
  }))
  return {
    day: dayKey,
    sessions,
    messages: sessions.reduce((s, x) => s + x.messages, 0),
    cost: sessions.reduce((s, x) => s + x.cost, 0),
  }
}

export function sourceOf(entrypoint: string | null, inDesktop: boolean): SessionSource {
  if (entrypoint === 'cli') return 'cli'
  if (inDesktop || entrypoint?.includes('desktop')) return 'desktop'
  return entrypoint ? 'other' : 'cli'
}

export interface SessionQuery {
  q?: string | null
  project?: string | null
  source?: SessionSource | null
  limit?: number
  offset?: number
}

export function sessions(db: Db, query: SessionQuery = {}): SessionList {
  const where = ['s.first_ts IS NOT NULL']
  const params: Record<string, string | number> = {}
  if (query.project) {
    where.push('s.project_key = $project')
    params.$project = query.project
  }
  if (query.q?.trim()) {
    params.$q = `%${query.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    where.push(`(${TITLE} LIKE $q ESCAPE '\\' OR EXISTS (SELECT 1 FROM prompts p WHERE p.session_id = s.id AND p.preview LIKE $q ESCAPE '\\'))`)
  }
  if (query.source === 'cli') where.push("s.entrypoint = 'cli' AND d.cli_session_id IS NULL")
  else if (query.source === 'desktop') where.push("(d.cli_session_id IS NOT NULL OR s.entrypoint LIKE '%desktop%')")
  const from = `FROM sessions s LEFT JOIN desktop_sessions d ON d.cli_session_id = s.id WHERE ${where.join(' AND ')}`
  const total = n((db.prepare(`SELECT count(*) AS c ${from}`).get(params) as Row).c)
  const ids = (db
    .prepare(`SELECT s.id ${from} ORDER BY s.last_ts DESC LIMIT $limit OFFSET $offset`)
    .all({ ...params, $limit: Math.min(query.limit ?? 50, 200), $offset: query.offset ?? 0 }) as { id: string }[]).map((r) => r.id)
  return { rows: sessionRows(db, ids), total }
}

export function session(db: Db, id: string): SessionRow | null {
  return sessionRows(db, [id])[0] ?? null
}

/** Full rows for the given session ids, in the given order. */
export function sessionRows(db: Db, ids: string[]): SessionRow[] {
  if (ids.length === 0) return []
  const list = JSON.stringify(ids)
  const inList = 'SELECT value FROM json_each($ids)'
  const p = { $ids: list }
  const base = new Map(
    (db.prepare(`SELECT s.*, ${TITLE} AS title, d.cli_session_id AS in_desktop, d.branch AS d_branch,
        d.worktree_name, d.archived,
        (SELECT count(*) FROM prompts WHERE session_id = s.id) AS prompts,
        (SELECT count(*) FROM api_calls WHERE session_id = s.id AND is_sidechain = 0) AS replies,
        (SELECT COALESCE(sum(cost), 0) FROM api_calls WHERE session_id = s.id) AS cost,
        (SELECT group_concat(DISTINCT model) FROM api_calls WHERE session_id = s.id) AS models,
        (SELECT count(*) FROM tool_uses WHERE session_id = s.id AND name IS NOT NULL) AS tool_calls,
        (SELECT count(*) FROM tool_uses WHERE session_id = s.id AND is_error = 1 AND denied IS NULL) AS tool_errors,
        (SELECT url FROM prs WHERE session_id = s.id ORDER BY ts DESC LIMIT 1) AS pr_url,
        (SELECT number FROM prs WHERE session_id = s.id ORDER BY ts DESC LIMIT 1) AS pr_number
      FROM sessions s LEFT JOIN desktop_sessions d ON d.cli_session_id = s.id
      WHERE s.id IN (${inList})`).all(p) as Row[]).map((r) => [String(r.id), r]),
  )

  const active = new Map(
    (db.prepare(`SELECT session_id, sum(CASE WHEN gap <= ${IDLE_GAP_MS} THEN gap ELSE 0 END) AS ms FROM (
        SELECT session_id, ts - LAG(ts) OVER (PARTITION BY session_id ORDER BY ts) AS gap FROM (
          SELECT session_id, ts FROM prompts WHERE session_id IN (${inList})
          UNION ALL SELECT session_id, ts FROM api_calls WHERE is_sidechain = 0 AND session_id IN (${inList})
        )
      ) GROUP BY session_id`).all(p) as Row[]).map((r) => [String(r.session_id), n(r.ms)]),
  )

  const runs = db.prepare(`SELECT c.*,
      (SELECT COALESCE(sum(cost), 0) FROM api_calls a WHERE a.session_id = c.session_id AND a.ts >= c.start_time) AS run_cost,
      (SELECT count(*) FROM api_calls a WHERE a.session_id = c.session_id AND a.ts >= c.start_time) AS run_calls
    FROM cost_states c WHERE c.session_id IN (${inList}) ORDER BY c.start_time`).all(p) as Row[]
  const runsBySession = new Map<string, Row[]>()
  for (const r of runs) {
    const k = String(r.session_id)
    runsBySession.set(k, [...(runsBySession.get(k) ?? []), r])
  }

  const out: SessionRow[] = []
  for (const id of ids) {
    const r = base.get(id)
    if (!r) continue
    // Forked sessions copy their parent's counter without owning any calls; skip those runs.
    const own = (runsBySession.get(id) ?? []).filter((x) => n(x.run_calls) > 0)
    const latest = own.at(-1)
    const coversWhole = own.length > 0 && n(own[0]?.start_time) <= n(r.first_ts)
    out.push({
      id,
      title: String(r.title),
      projectKey: String(r.project_key ?? ''),
      projectName: String(r.project_name ?? 'Bilinmeyen'),
      source: sourceOf((r.entrypoint as string | null) ?? null, r.in_desktop != null),
      gitBranch: branchName((r.d_branch as string | null) ?? (r.git_branch as string | null)),
      worktree: (r.worktree_name as string | null) ?? null,
      firstTs: n(r.first_ts),
      lastTs: n(r.last_ts),
      activeMs: active.get(id) ?? 0,
      prompts: n(r.prompts),
      messages: n(r.prompts) + n(r.replies),
      toolCalls: n(r.tool_calls),
      toolErrors: n(r.tool_errors),
      costEstimate: n(r.cost),
      counter: latest ? { cost: n(latest.total_cost), since: n(latest.start_time), transcriptCost: n(latest.run_cost) } : null,
      costHidden: own.reduce((s, x) => s + Math.max(0, n(x.total_cost) - n(x.run_cost)), 0),
      linesAdded: coversWhole ? own.reduce((s, x) => s + n(x.lines_added), 0) : null,
      linesRemoved: coversWhole ? own.reduce((s, x) => s + n(x.lines_removed), 0) : null,
      prUrl: (r.pr_url as string | null) ?? null,
      prNumber: (r.pr_number as number | null) ?? null,
      models: r.models ? String(r.models).split(',').sort() : [],
      archived: r.archived === 1,
    })
  }
  return out
}

/** A detached checkout reports "HEAD", which names no branch. */
function branchName(b: string | null): string | null {
  return b && b !== 'HEAD' ? b : null
}

export function projects(db: Db): ProjectOption[] {
  return all(db, `SELECT project_key AS key, project_name AS name, count(*) AS sessions FROM sessions
    WHERE first_ts IS NOT NULL AND project_key IS NOT NULL GROUP BY project_key ORDER BY max(last_ts) DESC`).map((r) => ({
    key: String(r.key), name: String(r.name), sessions: n(r.sessions),
  }))
}

const pct = (x: number) => `%${Math.round(x * 100)}`
const pctOf = (x: number) => withPossessive(x * 100, '%')

/** A few plain sentences about this week, each only when the data supports it. */
export function insights(db: Db): Insight[] {
  const t = today()
  const ws = weekStart(t)
  const lastWs = addDays(ws, -7)
  const out: Insight[] = []

  const byProject = all(db, `SELECT COALESCE(s.project_name, 'Bilinmeyen') AS name, sum(a.cost) AS cost
    FROM api_calls a LEFT JOIN sessions s ON s.id = a.session_id WHERE a.day BETWEEN ? AND ?
    GROUP BY COALESCE(s.project_key, '?') ORDER BY cost DESC`, ws, t)
  const weekCost = byProject.reduce((s, r) => s + n(r.cost), 0)
  const topProject = byProject[0]
  if (topProject && byProject.length > 1 && weekCost > 1 && n(topProject.cost) / weekCost >= 0.3) {
    out.push({ tone: 'neutral', text: `Bu haftaki maliyetin ${pctOf(n(topProject.cost) / weekCost)} tek projeden geldi: ${topProject.name}.` })
  }

  const errors = all(db, `SELECT name, count(*) AS c FROM tool_uses
    WHERE day BETWEEN ? AND ? AND is_error = 1 AND denied IS NULL AND name IS NOT NULL GROUP BY name ORDER BY c DESC`, ws, t)
  const errTotal = errors.reduce((s, r) => s + n(r.c), 0)
  const topErr = errors[0]
  if (topErr && errTotal >= 5) {
    out.push({
      tone: 'warn',
      text: n(topErr.c) === errTotal
        ? `Bu hafta ${errTotal} araç hatası oldu, hepsi ${topErr.name} aracında.`
        : n(topErr.c) / errTotal >= 0.4
        ? `Araç hatalarının çoğu ${topErr.name} aracından: ${errTotal} hatanın ${withPossessive(n(topErr.c))}.`
        : `Bu hafta ${errTotal} araç hatası oldu, en çok ${topErr.name} aracında (${n(topErr.c)}).`,
    })
  }

  const hitRate = (from: string, to: string) => {
    const r = one(db, `SELECT sum(cache_read) AS r, sum(input + cache_write_5m + cache_write_1h) AS other
      FROM api_calls WHERE day BETWEEN ? AND ?`, from, to)
    const total = n(r?.r) + n(r?.other)
    return total > 0 ? n(r?.r) / total : null
  }
  const now = hitRate(ws, t)
  const before = hitRate(lastWs, addDays(ws, -1))
  if (now !== null && before !== null) {
    const diff = Math.round((now - before) * 100)
    if (Math.abs(diff) >= 3) {
      out.push({
        tone: diff > 0 ? 'good' : 'warn',
        text: `Önbellek isabet oranın ${pct(now)}, geçen haftadan ${Math.abs(diff)} puan ${diff > 0 ? 'yüksek' : 'düşük'}.`,
      })
    } else {
      out.push({ tone: 'neutral', text: `Önbellek isabet oranın ${pct(now)}, geçen haftayla aynı seviyede.` })
    }
  }

  const peak = one(db, `SELECT hour, count(*) AS c FROM prompts WHERE day BETWEEN ? AND ? GROUP BY hour ORDER BY c DESC LIMIT 1`,
    addDays(t, -27), t)
  if (peak && n(peak.c) >= 10) {
    const h = n(peak.hour)
    out.push({ tone: 'neutral', text: `Son dört haftada en çok ${String(h).padStart(2, '0')}:00–${String((h + 1) % 24).padStart(2, '0')}:00 arasında yazdın.` })
  }
  return out
}

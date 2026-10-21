import type {
  DayDetail, HeatmapResponse, HeatmapView, Insight, Metric, PeriodTotals, RangeKey, SessionList, SessionRow, SessionSource, Summary,
} from '../shared/types.ts'
import type { Db } from './db.ts'
import { budgetCrossing } from './costs.ts'
import { WEEKLY_AFTER_DAYS, rangeBounds } from './range.ts'
import { matchFor, searchSessions } from './search.ts'
import { type Lang, dayMonth as formatDayMonth, formatInt, formatUsd, pick } from '../shared/i18n.ts'
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

export function heatmap(db: Db, view: HeatmapView, metric: Metric, from: string, to: string, project: string | null = null, lang: Lang = 'tr'): HeatmapResponse {
  const agg = metric === 'sessions' ? 'COUNT(DISTINCT f.session_id)' : 'SUM(f.v)'
  const scope = project ? ' AND session_id IN (SELECT id FROM sessions WHERE project_key = $project)' : ''
  const facts = FACTS[metric].replaceAll('day BETWEEN $from AND $to', `day BETWEEN $from AND $to${scope}`)
  const params: Record<string, string> = { $from: from, $to: to }
  if (project) params.$project = project
  let cells: { key: string; value: number }[]
  let projects: HeatmapResponse['projects'] = []

  // Long project ranges go by week (keyed by Monday), so the grid keeps readable columns.
  const days = Math.round((Date.parse(`${to}T12:00:00`) - Date.parse(`${from}T12:00:00`)) / 86_400_000) + 1
  const weekly = view === 'project' && days > WEEKLY_AFTER_DAYS
  const columns: string[] = []
  if (view === 'project') for (let d = weekly ? weekStart(from) : from; d <= to; d = addDays(d, weekly ? 7 : 1)) columns.push(d)

  if (view === 'project') {
    const bucket = weekly ? "date(f.day, '-' || f.dow || ' days')" : 'f.day'
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
        SELECT COALESCE(s.project_key, '?') AS pkey, ${bucket} AS day, ${agg} AS value
        FROM f LEFT JOIN sessions s ON s.id = f.session_id GROUP BY pkey, ${bucket}`)
      .all(params) as { pkey: string; day: string; value: number }[]
    cells = []
    const other = new Map<string, number>()
    for (const r of raw) {
      if (topKeys.has(r.pkey)) cells.push({ key: `${r.pkey}|${r.day}`, value: n(r.value) })
      else other.set(r.day, (other.get(r.day) ?? 0) + n(r.value))
    }
    if (rest.length > 0) {
      // Distinct-session counts can't be summed across projects exactly; the sum is an upper bound.
      const name = pick(lang, `Diğer ${rest.length} proje`, `${rest.length} other ${rest.length === 1 ? 'project' : 'projects'}`)
      projects.push({ key: '__other__', name, total: rest.reduce((s, p) => s + n(p.total), 0) })
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
    view, metric, from, to, cells, projects, columns, bucket: weekly ? 'week' : 'day',
    max: cells.reduce((m, c) => Math.max(m, c.value), 0),
    total: n(totalRow?.total),
  }
}

function messagesOn(db: Db, from: string, to: string): number {
  const r = db.prepare(`SELECT (SELECT count(*) FROM prompts WHERE day BETWEEN $from AND $to)
    + (SELECT count(*) FROM api_calls WHERE is_sidechain = 0 AND day BETWEEN $from AND $to) AS c`).get({ $from: from, $to: to }) as Row | undefined
  return n(r?.c)
}

function costBetween(db: Db, from: string, to: string): number {
  return n(one(db, 'SELECT COALESCE(sum(cost), 0) AS c FROM api_calls WHERE day BETWEEN ? AND ?', from, to)?.c)
}

/** Messages, tokens by kind and cost for one range. */
export function periodTotals(db: Db, key: RangeKey): PeriodTotals {
  const r = rangeBounds(db, key)
  const t = one(db, `SELECT COALESCE(sum(input), 0) AS input, COALESCE(sum(output), 0) AS output, COALESCE(sum(cache_read), 0) AS cache_read,
      COALESCE(sum(cache_write_5m + cache_write_1h), 0) AS cache_write, COALESCE(sum(cost), 0) AS cost
    FROM api_calls WHERE day BETWEEN ? AND ?`, r.from, r.to)
  return {
    key, from: r.from, to: r.to,
    messages: messagesOn(db, r.from, r.to),
    input: n(t?.input), output: n(t?.output), cacheRead: n(t?.cache_read), cacheWrite: n(t?.cache_write), cost: n(t?.cost),
  }
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
    periods: (['week', '30d', 'all'] as const).map((k) => periodTotals(db, k)),
    week: { cost: costBetween(db, ws, t), lastWeekCost: costBetween(db, lastWs, addDays(lastWs, elapsed)) },
    live,
    streak: { current, longest, activeToday: active.has(t) },
    totals: { sessions: n(totals?.c), firstDay },
  }
}

const TITLE = `COALESCE(NULLIF(s.custom_title, ''), NULLIF(d.title, ''), NULLIF(s.ai_title, ''), NULLIF(s.first_prompt, ''), 'Adsız oturum')`

export function day(db: Db, dayKey: string): DayDetail {
  const rows = db.prepare(`
    WITH f AS (
      SELECT session_id, ts, 1 AS msg, 0 AS cost, 0 AS err FROM prompts WHERE day = $day
      UNION ALL SELECT session_id, ts, 1 - is_sidechain, COALESCE(cost, 0), 0 FROM api_calls WHERE day = $day
      UNION ALL SELECT session_id, ts, 0, 0, 1 FROM tool_uses WHERE day = $day AND is_error = 1 AND denied IS NULL
      UNION ALL SELECT session_id, ts, 0, 0, 1 FROM events WHERE day = $day AND kind = 'api_error'
    )
    SELECT f.session_id AS id, ${TITLE} AS title, COALESCE(s.project_name, 'Bilinmeyen') AS project,
      min(f.ts) AS first_ts, max(f.ts) AS last_ts, sum(f.msg) AS messages, sum(f.cost) AS cost, sum(f.err) AS errors
    FROM f LEFT JOIN sessions s ON s.id = f.session_id LEFT JOIN desktop_sessions d ON d.cli_session_id = f.session_id
    GROUP BY f.session_id ORDER BY first_ts`).all({ $day: dayKey }) as Row[]
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
  /** Only sessions with activity in the range. */
  range?: RangeKey | null
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
  if (query.source === 'cli') where.push("s.entrypoint = 'cli' AND d.cli_session_id IS NULL")
  else if (query.source === 'desktop') where.push("(d.cli_session_id IS NOT NULL OR s.entrypoint LIKE '%desktop%')")
  if (query.range && query.range !== 'all') {
    where.push('s.last_ts >= $rangeFrom')
    params.$rangeFrom = rangeBounds(db, query.range).fromMs
  }
  const limit = Math.min(query.limit ?? 50, 200)
  const offset = query.offset ?? 0
  const q = query.q?.trim()

  if (!q) {
    const from = `FROM sessions s LEFT JOIN desktop_sessions d ON d.cli_session_id = s.id WHERE ${where.join(' AND ')}`
    const total = n((db.prepare(`SELECT count(*) AS c ${from}`).get(params) as Row).c)
    const ids = (db
      .prepare(`SELECT s.id ${from} ORDER BY s.last_ts DESC LIMIT $limit OFFSET $offset`)
      .all({ ...params, $limit: limit, $offset: offset }) as { id: string }[]).map((r) => r.id)
    return { rows: sessionRows(db, ids), total }
  }

  // Title matches come first, then sessions ranked by their best full-text match.
  const hits = searchSessions(db, q)
  params.$like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  const titled = (db.prepare(`SELECT s.id FROM sessions s LEFT JOIN desktop_sessions d ON d.cli_session_id = s.id
      WHERE ${where.join(' AND ')} AND ${TITLE} LIKE $like ESCAPE '\\' ORDER BY s.last_ts DESC`).all(params) as { id: string }[]).map((r) => r.id)
  delete params.$like
  const allowed = new Set(
    (db.prepare(`SELECT s.id FROM sessions s LEFT JOIN desktop_sessions d ON d.cli_session_id = s.id
        WHERE ${where.join(' AND ')} AND s.id IN (SELECT value FROM json_each($ids))`).all({ ...params, $ids: JSON.stringify(hits.order) }) as { id: string }[]).map((r) => r.id),
  )
  const ordered = [...new Set([...titled, ...hits.order.filter((id) => allowed.has(id))])]
  const page = ordered.slice(offset, offset + limit)
  const rows = sessionRows(db, page).map((row) => {
    const h = hits.bySession.get(row.id)
    return { ...row, match: h ? matchFor(db, q, h.bestId, h.hits) : null }
  })
  return { rows, total: ordered.length }
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
        (SELECT COALESCE(sum(added), 0) FROM file_edits WHERE session_id = s.id) AS lines_added,
        (SELECT COALESCE(sum(removed), 0) FROM file_edits WHERE session_id = s.id) AS lines_removed,
        (SELECT url FROM prs WHERE session_id = s.id ORDER BY ts DESC LIMIT 1) AS pr_url,
        (SELECT number FROM prs WHERE session_id = s.id ORDER BY ts DESC LIMIT 1) AS pr_number,
        NOT EXISTS (SELECT 1 FROM files WHERE session_id = s.id) AS history_only
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
      linesAdded: n(r.lines_added),
      linesRemoved: n(r.lines_removed),
      prUrl: (r.pr_url as string | null) ?? null,
      prNumber: (r.pr_number as number | null) ?? null,
      models: r.models ? String(r.models).split(',').sort() : [],
      archived: r.archived === 1,
      historyOnly: r.history_only === 1,
    })
  }
  return out
}

/** A detached checkout reports "HEAD", which names no branch. */
function branchName(b: string | null): string | null {
  return b && b !== 'HEAD' ? b : null
}

/** A few plain sentences about this week, each only when the data supports it, most pressing first. */
export function insights(db: Db, monthlyBudget: number | null = null, lang: Lang = 'tr'): Insight[] {
  const L = <T>(tr: T, en: T) => pick(lang, tr, en)
  const pct = (x: number) => L(`%${Math.round(x * 100)}`, `${Math.round(x * 100)}%`)
  const int = (v: number) => formatInt(v, lang)
  const usd = (v: number) => formatUsd(v, lang, 0)
  const dayMonth = (day: string) => formatDayMonth(Number(day.slice(8, 10)), Number(day.slice(5, 7)) - 1, lang)
  const times = (c: number) => L(`${c} kez`, c === 1 ? 'once' : c === 2 ? 'twice' : `${c} times`)
  const t = today()
  const ws = weekStart(t)
  const lastWs = addDays(ws, -7)
  const ranked: { rank: number; insight: Insight }[] = []
  const add = (rank: number, insight: Insight) => ranked.push({ rank, insight })
  const wsMs = Date.parse(`${ws}T00:00:00`)

  if (monthlyBudget) {
    const first = `${t.slice(0, 7)}-01`
    const daily = all(db, 'SELECT day, sum(cost) AS cost FROM api_calls WHERE day BETWEEN ? AND ? GROUP BY day ORDER BY day', first, t).map((r) => ({
      day: String(r.day), cost: n(r.cost),
    }))
    const monthCost = daily.reduce((s, d) => s + d.cost, 0)
    const [y, m] = t.split('-').map(Number) as [number, number]
    const elapsed = Math.max(1, (Date.now() - new Date(y, m - 1, 1).getTime()) / 86_400_000)
    const crosses = budgetCrossing(daily, monthlyBudget, monthCost, elapsed, first, new Date(y, m, 0).getDate())
    if (monthCost >= monthlyBudget) {
      add(0, { tone: 'warn', href: '/maliyet', text: L(
        `Aylık ${usd(monthlyBudget)} bütçeni aştın; bu ay ${usd(monthCost)} harcandı.`,
        `You are over your ${usd(monthlyBudget)} monthly budget; ${usd(monthCost)} spent this month.`,
      ) })
    } else if (crosses) {
      add(0, { tone: 'warn', href: '/maliyet', text: L(
        `Bu hızla aylık ${usd(monthlyBudget)} bütçeni ${dayMonth(crosses)} tarihinde aşacaksın.`,
        `At this pace you will go over your ${usd(monthlyBudget)} monthly budget on ${dayMonth(crosses)}.`,
      ) })
    } else {
      add(9, { tone: 'good', href: '/maliyet', text: L(
        `Bu ay ${usd(monthCost)} harcandı; bu hızla ${usd(monthlyBudget)} bütçenin içinde kalıyorsun.`,
        `${usd(monthCost)} spent this month; at this pace you stay within your ${usd(monthlyBudget)} budget.`,
      ) })
    }
  }

  const hits = all(db, `SELECT kind, count(*) AS c FROM (SELECT kind, resets_at, min(ts) AS at FROM limit_hits GROUP BY kind, resets_at)
    WHERE at >= ? GROUP BY kind`, wsMs)
  const hitText = hits
    .map((h) => L(
      `${h.kind === 'seven_day' ? 'haftalık' : h.kind === 'five_hour' ? '5 saatlik' : 'bir'} limite ${n(h.c)} kez`,
      `the ${h.kind === 'seven_day' ? 'weekly' : h.kind === 'five_hour' ? '5-hour' : 'usage'} limit ${times(n(h.c))}`,
    ))
    .join(L(', ', ' and '))
  if (hitText) add(1, { tone: 'warn', href: '/maliyet', text: L(`Bu hafta ${hitText} takıldın.`, `This week you hit ${hitText}.`) })

  const byProject = all(db, `SELECT COALESCE(s.project_name, 'Bilinmeyen') AS name, sum(a.cost) AS cost
    FROM api_calls a LEFT JOIN sessions s ON s.id = a.session_id WHERE a.day BETWEEN ? AND ?
    GROUP BY COALESCE(s.project_key, '?') ORDER BY cost DESC`, ws, t)
  const weekCost = byProject.reduce((s, r) => s + n(r.cost), 0)
  const topProject = byProject[0]
  if (topProject && byProject.length > 1 && weekCost > 1 && n(topProject.cost) / weekCost >= 0.3) {
    add(2, { tone: 'neutral', text: L(
      `Bu haftaki maliyetin ${withPossessive((n(topProject.cost) / weekCost) * 100, '%')} tek projeden geldi: ${topProject.name}.`,
      `${pct(n(topProject.cost) / weekCost)} of this week's cost came from one project: ${topProject.name}.`,
    ) })
  }

  const lines = all(db, `SELECT s.project_key AS key, COALESCE(s.project_name, 'Bilinmeyen') AS name, sum(e.added) AS added, sum(e.removed) AS removed
    FROM file_edits e LEFT JOIN sessions s ON s.id = e.session_id WHERE e.day BETWEEN ? AND ?
    GROUP BY s.project_key ORDER BY sum(e.added) + sum(e.removed) DESC`, ws, t)
  const added = lines.reduce((s, r) => s + n(r.added), 0)
  const removed = lines.reduce((s, r) => s + n(r.removed), 0)
  const topLines = lines[0]
  if (topLines && added + removed >= 50) {
    const key = typeof topLines.key === 'string' && topLines.key.startsWith('/') ? topLines.key : null
    add(3, {
      tone: 'neutral',
      href: key ? `/projeler/${encodeURIComponent(key)}` : undefined,
      text: L(
        `Bu hafta Claude ${int(added)} satır ekledi, ${int(removed)} satır sildi. En çok değişen proje: ${topLines.name}.`,
        `This week Claude added ${int(added)} ${added === 1 ? 'line' : 'lines'} and removed ${int(removed)}. Most changed project: ${topLines.name}.`,
      ),
    })
  }

  // Tasks still open in sessions nobody has touched for a day.
  const stale = one(db, `SELECT count(*) AS tasks, count(DISTINCT t.session_id) AS sessions FROM tasks t JOIN sessions s ON s.id = t.session_id
    WHERE t.status IN ('pending', 'in_progress') AND s.last_ts < ?`, Date.now() - 86_400_000)
  if (stale && n(stale.tasks) > 0) {
    const tasks = n(stale.tasks)
    const sessions = n(stale.sessions)
    add(4, { tone: 'neutral', href: '/ortam?bolum=gorevler', text: L(
      `${int(sessions)} oturumda ${int(tasks)} görev yarım kaldı.`,
      `${int(tasks)} ${tasks === 1 ? 'task was' : 'tasks were'} left unfinished in ${int(sessions)} ${sessions === 1 ? 'session' : 'sessions'}.`,
    ) })
  }

  const errors = all(db, `SELECT name, count(*) AS c FROM tool_uses
    WHERE day BETWEEN ? AND ? AND is_error = 1 AND denied IS NULL AND name IS NOT NULL GROUP BY name ORDER BY c DESC`, ws, t)
  const errTotal = errors.reduce((s, r) => s + n(r.c), 0)
  const topErr = errors[0]
  if (topErr && errTotal >= 5) {
    add(5, {
      tone: 'warn',
      text: n(topErr.c) === errTotal
        ? L(`Bu hafta ${errTotal} araç hatası oldu, hepsi ${topErr.name} aracında.`, `This week there were ${errTotal} tool errors, all in ${topErr.name}.`)
        : n(topErr.c) / errTotal >= 0.4
          ? L(
            `Araç hatalarının çoğu ${topErr.name} aracından: ${errTotal} hatanın ${withPossessive(n(topErr.c))}.`,
            `Most tool errors came from ${topErr.name}: ${n(topErr.c)} of ${errTotal}.`,
          )
          : L(
            `Bu hafta ${errTotal} araç hatası oldu, en çok ${topErr.name} aracında (${n(topErr.c)}).`,
            `This week there were ${errTotal} tool errors, most of them in ${topErr.name} (${n(topErr.c)}).`,
          ),
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
      add(6, {
        tone: diff > 0 ? 'good' : 'warn',
        text: L(
          `Cache hit oranın ${pct(now)}, geçen haftadan ${Math.abs(diff)} puan ${diff > 0 ? 'yüksek' : 'düşük'}.`,
          `Your cache hit rate is ${pct(now)}, ${Math.abs(diff)} ${Math.abs(diff) === 1 ? 'point' : 'points'} ${diff > 0 ? 'higher' : 'lower'} than last week.`,
        ),
      })
    } else {
      add(8, { tone: 'neutral', text: L(`Cache hit oranın ${pct(now)}, geçen haftayla aynı seviyede.`, `Your cache hit rate is ${pct(now)}, about the same as last week.`) })
    }
  }

  const interrupts = n(one(db, `SELECT count(*) AS c FROM events WHERE kind = 'interrupt' AND day BETWEEN ? AND ?`, ws, t)?.c)
  if (interrupts >= 5) add(7, { tone: 'neutral', text: L(`Bu hafta ${int(interrupts)} yanıtı yarıda kestin.`, `This week you interrupted ${int(interrupts)} responses.`) })

  const peak = one(db, `SELECT hour, count(*) AS c FROM prompts WHERE day BETWEEN ? AND ? GROUP BY hour ORDER BY c DESC LIMIT 1`,
    addDays(t, -27), t)
  if (peak && n(peak.c) >= 10) {
    const h = n(peak.hour)
    const start = `${String(h).padStart(2, '0')}:00`
    const end = `${String((h + 1) % 24).padStart(2, '0')}:00`
    add(8, { tone: 'neutral', text: L(`Son dört haftada en çok ${start}–${end} arasında yazdın.`, `Over the last four weeks you wrote the most between ${start} and ${end}.`) })
  }
  return ranked.sort((a, b) => a.rank - b.rank).slice(0, 6).map((r) => r.insight)
}

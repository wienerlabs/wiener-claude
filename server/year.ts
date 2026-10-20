import type { YearReport } from '../shared/types.ts'
import type { Db } from './db.ts'
import { normalizeModel } from './pricing.ts'
import { addDays, today } from './time.ts'

type Row = Record<string, unknown>
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

const TITLE = `COALESCE(NULLIF(s.custom_title, ''), NULLIF(d.title, ''), NULLIF(s.ai_title, ''), NULLIF(s.first_prompt, ''), 'Adsız oturum')`

// Messages are what the person typed plus Claude's main-thread replies, as everywhere else.
const MESSAGES = `SELECT session_id, day, hour, dow FROM prompts WHERE day BETWEEN $from AND $to
  UNION ALL SELECT session_id, day, hour, dow FROM api_calls WHERE is_sidechain = 0 AND day BETWEEN $from AND $to`

export function yearsWithData(db: Db): number[] {
  return (db.prepare(`SELECT DISTINCT substr(day, 1, 4) AS y FROM api_calls UNION SELECT DISTINCT substr(day, 1, 4) FROM prompts ORDER BY y DESC`)
    .all() as Row[]).map((r) => Number(r.y)).filter((y) => Number.isInteger(y) && y > 2000)
}

/** The longest run of consecutive active days. Ties keep the earlier run. */
export function longestStreak(days: string[]): YearReport['longestStreak'] {
  const sorted = [...days].sort()
  let best: YearReport['longestStreak'] = null
  let runStart = 0
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && addDays(sorted[i - 1] as string, 1) !== sorted[i]) runStart = i
    const len = i - runStart + 1
    if (!best || len > best.days) best = { days: len, from: sorted[runStart] as string, to: sorted[i] as string }
  }
  return best
}

export function yearReport(db: Db, year: number): YearReport {
  const t = today()
  const from = `${year}-01-01`
  const end = `${year}-12-31`
  const to = t < end ? t : end
  const p = { $from: from, $to: to }
  const rows = (sql: string) => db.prepare(sql).all(p) as Row[]
  const get = (sql: string) => (db.prepare(sql).get(p) as Row | undefined) ?? {}

  const days = rows(`SELECT day, count(*) AS messages FROM (${MESSAGES}) GROUP BY day ORDER BY day`).map((r) => ({ day: String(r.day), messages: n(r.messages) }))
  const months = new Array<number>(12).fill(0)
  for (const d of days) months[Number(d.day.slice(5, 7)) - 1]! += d.messages
  const busiest = days.reduce<{ day: string; messages: number } | null>((b, d) => (!b || d.messages > b.messages ? d : b), null)
  const peak = (col: 'hour' | 'dow') => {
    const r = get(`SELECT ${col} AS k, count(*) AS c FROM (${MESSAGES}) GROUP BY ${col} ORDER BY c DESC LIMIT 1`)
    return typeof r.k === 'number' ? r.k : null
  }

  const counts = get(`SELECT
      (SELECT count(DISTINCT session_id) FROM (${MESSAGES})) AS sessions,
      (SELECT count(*) FROM prompts WHERE day BETWEEN $from AND $to) AS prompts,
      (SELECT count(*) FROM tool_uses WHERE name IS NOT NULL AND day BETWEEN $from AND $to) AS tool_calls,
      (SELECT COALESCE(sum(added), 0) FROM file_edits WHERE day BETWEEN $from AND $to) AS added,
      (SELECT COALESCE(sum(removed), 0) FROM file_edits WHERE day BETWEEN $from AND $to) AS removed,
      (SELECT count(DISTINCT path) FROM file_edits WHERE day BETWEEN $from AND $to) AS files`)
  const spend = get(`SELECT COALESCE(sum(input + output + cache_read + cache_write_5m + cache_write_1h), 0) AS tokens,
      COALESCE(sum(output), 0) AS output, COALESCE(sum(cost), 0) AS cost FROM api_calls WHERE day BETWEEN $from AND $to`)
  const startMs = Date.parse(`${from}T00:00:00`)
  const endMs = Date.parse(`${addDays(to, 1)}T00:00:00`)
  const prs = n((db.prepare('SELECT count(*) AS c FROM prs WHERE ts >= ? AND ts < ?').get(startMs, endMs) as Row).c)

  const projects = rows(`SELECT s.project_key AS key, COALESCE(s.project_name, 'Bilinmeyen') AS name, count(*) AS messages
      FROM (${MESSAGES}) f JOIN sessions s ON s.id = f.session_id GROUP BY s.project_key ORDER BY messages DESC LIMIT 5`)
  const projectCost = new Map(rows(`SELECT s.project_key AS key, sum(a.cost) AS cost
      FROM api_calls a JOIN sessions s ON s.id = a.session_id WHERE a.day BETWEEN $from AND $to GROUP BY s.project_key`).map((r) => [String(r.key), n(r.cost)]))

  // MCP tools count under their server, so one busy server isn't split into a dozen rows.
  const tools = rows(`SELECT CASE WHEN mcp_server IS NOT NULL THEN mcp_server ELSE name END AS name, count(*) AS calls
      FROM tool_uses WHERE name IS NOT NULL AND day BETWEEN $from AND $to GROUP BY 1 ORDER BY calls DESC LIMIT 5`)
    .map((r) => ({ name: String(r.name), calls: n(r.calls) }))

  const byModel = new Map<string, number>()
  let replies = 0
  for (const r of rows(`SELECT model, count(*) AS c FROM api_calls WHERE is_sidechain = 0 AND day BETWEEN $from AND $to GROUP BY model`)) {
    const m = normalizeModel(String(r.model))
    byModel.set(m, (byModel.get(m) ?? 0) + n(r.c))
    replies += n(r.c)
  }
  const topModel = [...byModel].sort((a, b) => b[1] - a[1])[0]

  const top = (sql: string) => {
    const r = get(sql)
    return typeof r.name === 'string' ? { name: r.name, calls: n(r.calls) } : null
  }
  const command = top(`SELECT CASE WHEN instr(preview, ' ') > 0 THEN substr(preview, 1, instr(preview, ' ') - 1) ELSE preview END AS name, count(*) AS calls
    FROM prompts WHERE kind = 'command' AND day BETWEEN $from AND $to GROUP BY 1 ORDER BY calls DESC LIMIT 1`)

  const longest = get(`SELECT f.session_id AS id, ${TITLE} AS title, count(*) AS messages
    FROM (${MESSAGES}) f JOIN sessions s ON s.id = f.session_id LEFT JOIN desktop_sessions d ON d.cli_session_id = s.id
    GROUP BY f.session_id ORDER BY messages DESC LIMIT 1`)

  return {
    year,
    years: yearsWithData(db),
    from,
    to,
    partial: to < end,
    firstDay: days[0]?.day ?? null,
    days,
    totals: {
      sessions: n(counts.sessions),
      messages: days.reduce((s, d) => s + d.messages, 0),
      prompts: n(counts.prompts),
      tokens: n(spend.tokens),
      outputTokens: n(spend.output),
      cost: n(spend.cost),
      linesAdded: n(counts.added),
      linesRemoved: n(counts.removed),
      files: n(counts.files),
      prs,
      toolCalls: n(counts.tool_calls),
    },
    activeDays: days.length,
    longestStreak: longestStreak(days.map((d) => d.day)),
    busiestDay: busiest,
    months,
    peakHour: peak('hour'),
    peakWeekday: peak('dow'),
    projects: projects.map((r) => ({ name: String(r.name), messages: n(r.messages), cost: projectCost.get(String(r.key)) ?? 0 })),
    tools,
    model: topModel && replies > 0 ? { name: topModel[0], share: topModel[1] / replies } : null,
    skill: top(`SELECT detail AS name, count(*) AS calls FROM tool_uses WHERE name = 'Skill' AND detail IS NOT NULL AND day BETWEEN $from AND $to
      GROUP BY detail ORDER BY calls DESC LIMIT 1`),
    command: command ? { name: command.name, uses: command.calls } : null,
    agent: top(`SELECT detail AS name, count(*) AS calls FROM tool_uses WHERE name IN ('Agent', 'Task') AND detail IS NOT NULL AND day BETWEEN $from AND $to
      GROUP BY detail ORDER BY calls DESC LIMIT 1`),
    longestSession: typeof longest.id === 'string' ? { id: longest.id, title: String(longest.title), messages: n(longest.messages) } : null,
  }
}

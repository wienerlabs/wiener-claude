import type { FeatureKey, RangeKey, ToolCategory, ToolsReport, UsageStat } from '../shared/types.ts'
import type { Db } from './db.ts'
import { rangeBounds } from './range.ts'

type Row = Record<string, unknown>
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

const CATEGORY: Record<string, ToolCategory> = {
  Bash: 'shell', BashOutput: 'shell', KillShell: 'shell', KillBash: 'shell', Monitor: 'shell',
  Read: 'files', Edit: 'files', MultiEdit: 'files', Write: 'files', NotebookEdit: 'files', NotebookRead: 'files', Glob: 'files', Grep: 'files', LS: 'files',
  WebFetch: 'web', WebSearch: 'web',
  Agent: 'agents', Task: 'agents', TaskOutput: 'agents', TaskStop: 'agents', SendMessage: 'agents', ListAgents: 'agents', SubagentHandback: 'agents', Workflow: 'agents',
  TodoWrite: 'planning', TaskCreate: 'planning', TaskUpdate: 'planning', TaskList: 'planning', TaskGet: 'planning',
  EnterPlanMode: 'planning', ExitPlanMode: 'planning', AskUserQuestion: 'planning',
  Skill: 'skills',
}

export function categoryOf(name: string): ToolCategory {
  if (name.startsWith('mcp__')) return 'mcp'
  return CATEGORY[name] ?? 'other'
}

/**
 * Which sessions used a feature, as SQL returning (session_id, uses). The base is the sessions
 * with a message in the range, so a share reads "used in 4 of 10 sessions".
 */
const FEATURES: [FeatureKey, string][] = [
  ['subagents', `SELECT session_id FROM tool_uses WHERE name IN ('Agent', 'Task') AND $range`],
  ['skills', `SELECT session_id FROM tool_uses WHERE name = 'Skill' AND $range`],
  ['mcp', `SELECT session_id FROM tool_uses WHERE mcp_server IS NOT NULL AND $range`],
  ['plan', `SELECT session_id FROM tool_uses WHERE name = 'ExitPlanMode' AND $range`],
  ['tasks', `SELECT session_id FROM tool_uses WHERE name IN ('TodoWrite', 'TaskCreate', 'TaskUpdate') AND $range`],
  ['web', `SELECT session_id FROM tool_uses WHERE name IN ('WebFetch', 'WebSearch') AND $range`],
  ['questions', `SELECT session_id FROM tool_uses WHERE name = 'AskUserQuestion' AND $range`],
  ['commands', `SELECT session_id FROM prompts WHERE kind = 'command' AND $range`],
  ['shell', `SELECT session_id FROM prompts WHERE kind = 'bash' AND $range`],
  ['compact', `SELECT session_id FROM events WHERE kind = 'compact' AND $range`],
  ['interrupt', `SELECT session_id FROM events WHERE kind = 'interrupt' AND $range`],
  ['fast', `SELECT session_id FROM api_calls WHERE fast = 1 AND $range`],
]

export function toolsReport(db: Db, rangeKey: RangeKey = '30d'): ToolsReport {
  const range = rangeBounds(db, rangeKey)
  const { fromMs, ...rangeInfo } = range
  const p = { $from: range.from, $to: range.to }
  const inRange = 'day BETWEEN $from AND $to'
  const rows = (sql: string) => db.prepare(sql).all(p) as Row[]
  const usage = (r: Row): UsageStat => ({ name: String(r.name), calls: n(r.calls), sessions: n(r.sessions), lastTs: n(r.last_ts) })

  const sessions = n((db.prepare(`SELECT count(*) AS c FROM (
      SELECT session_id FROM prompts WHERE ${inRange} UNION SELECT session_id FROM api_calls WHERE is_sidechain = 0 AND ${inRange})`).get(p) as Row).c)

  // tool_uses rows without a name are results whose call was never seen; they are not calls.
  const byName = rows(`SELECT name, count(*) AS calls,
      sum(CASE WHEN is_error = 1 AND denied IS NULL THEN 1 ELSE 0 END) AS errors,
      sum(CASE WHEN denied IS NOT NULL THEN 1 ELSE 0 END) AS denied,
      count(DISTINCT session_id) AS sessions
    FROM tool_uses WHERE name IS NOT NULL AND ${inRange} GROUP BY name ORDER BY calls DESC`)

  const categories = new Map<ToolCategory, number>()
  let calls = 0
  let errors = 0
  let denied = 0
  for (const r of byName) {
    const c = categoryOf(String(r.name))
    categories.set(c, (categories.get(c) ?? 0) + n(r.calls))
    calls += n(r.calls)
    errors += n(r.errors)
    denied += n(r.denied)
  }

  const tools = byName
    .filter((r) => !String(r.name).startsWith('mcp__'))
    .slice(0, 24)
    .map((r) => ({
      name: String(r.name), category: categoryOf(String(r.name)),
      calls: n(r.calls), errors: n(r.errors), denied: n(r.denied), sessions: n(r.sessions),
    }))

  const mcpTools = new Map<string, { name: string; calls: number }[]>()
  for (const r of byName) {
    const name = String(r.name)
    if (!name.startsWith('mcp__')) continue
    const [, server = '', ...rest] = name.split('__')
    const list = mcpTools.get(server) ?? []
    list.push({ name: rest.join('__') || name, calls: n(r.calls) })
    mcpTools.set(server, list)
  }
  const mcp = rows(`SELECT mcp_server AS name, count(*) AS calls, count(DISTINCT session_id) AS sessions, max(ts) AS last_ts,
      sum(CASE WHEN is_error = 1 AND denied IS NULL THEN 1 ELSE 0 END) AS errors
    FROM tool_uses WHERE mcp_server IS NOT NULL AND name IS NOT NULL AND ${inRange} GROUP BY mcp_server ORDER BY calls DESC LIMIT 16`)
    .map((r) => ({ ...usage(r), errors: n(r.errors), tools: (mcpTools.get(String(r.name)) ?? []).slice(0, 4) }))

  const byDetail = (names: string) => rows(`SELECT detail AS name, count(*) AS calls, count(DISTINCT session_id) AS sessions, max(ts) AS last_ts
    FROM tool_uses WHERE name IN (${names}) AND detail IS NOT NULL AND ${inRange} GROUP BY detail ORDER BY calls DESC, last_ts DESC LIMIT 16`).map(usage)

  // Slash commands are kept as typed: "/compact keep the API notes" counts as /compact.
  const commands = rows(`SELECT CASE WHEN instr(preview, ' ') > 0 THEN substr(preview, 1, instr(preview, ' ') - 1) ELSE preview END AS name,
      count(*) AS calls, count(DISTINCT session_id) AS sessions, max(ts) AS last_ts
    FROM prompts WHERE kind = 'command' AND ${inRange} GROUP BY name ORDER BY calls DESC, last_ts DESC LIMIT 16`).map(usage)

  const spend = db.prepare(`SELECT COALESCE(sum(cost), 0) AS total, COALESCE(sum(CASE WHEN is_sidechain = 1 THEN cost ELSE 0 END), 0) AS side
    FROM api_calls WHERE ${inRange}`).get(p) as Row

  const features = FEATURES.map(([key, sql]) => {
    const r = db.prepare(`SELECT count(DISTINCT session_id) AS sessions, count(*) AS uses FROM (${sql.replace('$range', inRange)})`).get(p) as Row
    return { key, sessions: n(r.sessions), uses: n(r.uses) }
  })

  const events = new Map((rows(`SELECT kind, count(*) AS c FROM events WHERE ${inRange} GROUP BY kind`)).map((r) => [String(r.kind), n(r.c)]))

  // A session reports the version it last ran on.
  const versions = (db.prepare(`SELECT version, count(*) AS sessions, min(first_ts) AS first_ts, max(last_ts) AS last_ts
      FROM sessions WHERE version IS NOT NULL AND last_ts >= ? GROUP BY version ORDER BY last_ts DESC LIMIT 10`).all(fromMs) as Row[])
    .map((r) => ({ version: String(r.version), sessions: n(r.sessions), firstTs: n(r.first_ts), lastTs: n(r.last_ts) }))

  return {
    range: rangeInfo,
    sessions,
    totals: { calls, errors, denied, apiErrors: events.get('api_error') ?? 0, apiRetries: events.get('api_retry') ?? 0 },
    categories: [...categories].map(([key, c]) => ({ key, calls: c })).sort((a, b) => b.calls - a.calls),
    tools,
    mcp,
    skills: byDetail("'Skill'"),
    agents: byDetail("'Agent', 'Task'"),
    subagents: { cost: n(spend.side), share: n(spend.total) > 0 ? n(spend.side) / n(spend.total) : 0 },
    commands,
    features,
    versions,
  }
}

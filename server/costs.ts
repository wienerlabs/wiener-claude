import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { CostMix, CostReport, DailyCost, LimitHit, Limits, ModelCost, RangeKey, Suggestion } from '../shared/types.ts'
import { withPossessive } from '../shared/tr.ts'
import type { Db } from './db.ts'
import { type Pricing, normalizeModel } from './pricing.ts'
import { WEEKLY_AFTER_DAYS, previousBounds, rangeBounds } from './range.ts'
import { addDays, dayKey, today, weekStart } from './time.ts'

type Row = Record<string, unknown>
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const usd = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const usd2 = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
const money = (v: number) => (Math.abs(v) >= 100 ? usd.format(v) : usd2.format(v))

const HOUR = 3_600_000
const DAY = 24 * HOUR
const BLOCK = 5 * HOUR
/** A Claude Code utilization reading older than this no longer describes the current window. */
const MEASURE_FRESH_MS = 6 * HOUR
const BIG_CONTEXT = 200_000

// ---- account file -----------------------------------------------------------------------------

export interface AccountInfo {
  plan: string | null
  usage: { fetchedAt: number; fiveHour: { percent: number; resetsAt: number | null } | null; sevenDay: { percent: number; resetsAt: number | null } | null } | null
}

function accountFile(): string {
  return process.env.CLAUDE_CONFIG_DIR ? path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json') : path.join(os.homedir(), '.claude.json')
}

/** "default_claude_max_5x" -> "Max 5x" */
export function planName(tier: string | null, orgType: string | null): string | null {
  const t = (tier ?? '').toLowerCase()
  const max = t.match(/max_(\d+)x/)
  if (max) return `Max ${max[1]}x`
  if (t.includes('pro')) return 'Pro'
  if (t.includes('team')) return 'Team'
  if (t.includes('enterprise')) return 'Enterprise'
  if (orgType === 'claude_max') return 'Max'
  if (orgType === 'claude_pro') return 'Pro'
  return null
}

let cached: { mtime: number; info: AccountInfo } | null = null

/**
 * The plan and Claude Code's last usage reading from ~/.claude.json. Only those fields are read:
 * names, e-mail addresses and ids never leave this function.
 */
export function readAccount(file = accountFile()): AccountInfo | null {
  let mtime: number
  try {
    mtime = fs.statSync(file).mtimeMs
  } catch {
    return null
  }
  if (cached && cached.mtime === mtime && file === accountFile()) return cached.info
  try {
    const o = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
    const acct = (o.oauthAccount ?? {}) as Record<string, unknown>
    const plan = planName(
      typeof acct.organizationRateLimitTier === 'string' ? acct.organizationRateLimitTier : typeof acct.userRateLimitTier === 'string' ? acct.userRateLimitTier : null,
      typeof acct.organizationType === 'string' ? acct.organizationType : null,
    )
    const u = o.cachedUsageUtilization as Record<string, unknown> | undefined
    const util = (u?.utilization ?? {}) as Record<string, Record<string, unknown> | null>
    const window = (w: Record<string, unknown> | null | undefined) =>
      w && typeof w.utilization === 'number'
        ? { percent: w.utilization, resetsAt: typeof w.resets_at === 'string' ? Date.parse(w.resets_at) || null : null }
        : null
    const info: AccountInfo = {
      plan,
      usage: typeof u?.fetchedAtMs === 'number' ? { fetchedAt: u.fetchedAtMs, fiveHour: window(util.five_hour), sevenDay: window(util.seven_day) } : null,
    }
    if (file === accountFile()) cached = { mtime, info }
    return info
  } catch {
    return null
  }
}

// ---- limits -----------------------------------------------------------------------------------

/**
 * Usage windows start on the hour of the first request after the previous window ended and last
 * five hours. Returns the window that contains `now`, if any.
 */
export function currentBlock(timestamps: number[], now: number): { start: number; end: number } | null {
  let start: number | null = null
  for (const ts of timestamps) {
    if (start === null || ts >= start + BLOCK) start = Math.floor(ts / HOUR) * HOUR
  }
  return start !== null && now < start + BLOCK ? { start, end: start + BLOCK } : null
}

export function limits(db: Db, account: AccountInfo | null, now = Date.now()): Limits {
  const ts = (db.prepare('SELECT ts FROM api_calls WHERE ts >= ? ORDER BY ts').all(now - 2 * DAY) as { ts: number }[]).map((r) => r.ts)
  const window = currentBlock(ts, now)
  let block: Limits['block'] = null
  if (window) {
    const r = db.prepare(`SELECT (SELECT COALESCE(sum(cost), 0) FROM api_calls WHERE ts >= ?1) AS cost,
        (SELECT count(*) FROM prompts WHERE ts >= ?1) + (SELECT count(*) FROM api_calls WHERE ts >= ?1 AND is_sidechain = 0) AS messages`)
      .get(window.start) as Row
    block = { ...window, cost: n(r.cost), messages: n(r.messages) }
  }

  const hits = (db.prepare(`SELECT kind, resets_at, min(ts) AS at FROM limit_hits GROUP BY kind, resets_at ORDER BY at DESC LIMIT 12`).all() as Row[]).map(
    (r): LimitHit => ({ kind: r.kind as LimitHit['kind'], at: n(r.at), resetsAt: typeof r.resets_at === 'number' ? r.resets_at : null }),
  )
  const costSince = (from: number, to = now) =>
    n((db.prepare('SELECT COALESCE(sum(cost), 0) AS c FROM api_calls WHERE ts >= ? AND ts <= ?').get(from, to) as Row).c)
  const lastWeekly = hits.find((h) => h.kind === 'seven_day')

  const usage = account?.usage ?? null
  const fresh = (w: { resetsAt: number | null } | null) => !!usage && now - usage.fetchedAt < MEASURE_FRESH_MS && (w?.resetsAt ?? 0) > now
  return {
    plan: account?.plan ?? null,
    measured: usage
      ? {
          fetchedAt: usage.fetchedAt,
          fresh: fresh(usage.fiveHour) || fresh(usage.sevenDay),
          fiveHour: fresh(usage.fiveHour) ? usage.fiveHour : null,
          sevenDay: fresh(usage.sevenDay) ? usage.sevenDay : null,
        }
      : null,
    block,
    rolling7: {
      cost: costSince(now - 7 * DAY),
      atLastWeeklyHit: lastWeekly ? { at: lastWeekly.at, cost: costSince(lastWeekly.at - 7 * DAY, lastWeekly.at) } : null,
    },
    hits,
  }
}

// ---- cost report ------------------------------------------------------------------------------

function monthBounds(day: string) {
  const [y, m] = day.split('-').map(Number) as [number, number]
  const first = dayKey(new Date(y, m - 1, 1))
  const daysInMonth = new Date(y, m, 0).getDate()
  const prevFirst = dayKey(new Date(y, m - 2, 1))
  const prevLast = dayKey(new Date(y, m - 1, 0))
  const prevDays = new Date(y, m - 1, 0).getDate()
  const dom = Number(day.slice(8, 10))
  const prevToDate = dayKey(new Date(y, m - 2, Math.min(dom, prevDays)))
  return { first, daysInMonth, prevFirst, prevLast, prevToDate, startMs: new Date(y, m - 1, 1).getTime() }
}

interface UsageSums {
  model: string
  fast: number
  input: number
  output: number
  cache_read: number
  cache_write_5m: number
  cache_write_1h: number
  cost: number
  calls: number
}

function sums(db: Db, where: string, ...params: (string | number)[]): UsageSums[] {
  return db
    .prepare(`SELECT model, fast, sum(input) AS input, sum(output) AS output, sum(cache_read) AS cache_read,
        sum(cache_write_5m) AS cache_write_5m, sum(cache_write_1h) AS cache_write_1h, COALESCE(sum(cost), 0) AS cost, count(*) AS calls
      FROM api_calls WHERE ${where} GROUP BY model, fast`)
    .all(...params) as unknown as UsageSums[]
}

/** What each kind of token cost, priced per model. */
function mixOf(rows: UsageSums[], pricing: Pricing): CostMix {
  const mix: CostMix = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  for (const r of rows) {
    const p = pricing.prices[normalizeModel(r.model)]
    if (!p) continue
    const mult = r.fast && p.fastMultiplier ? p.fastMultiplier : 1
    mix.input += (r.input * p.input * mult) / 1e6
    mix.output += (r.output * p.output * mult) / 1e6
    mix.cacheRead += (r.cache_read * p.cacheRead * mult) / 1e6
    mix.cacheWrite += ((r.cache_write_5m * (p.cacheWrite5m ?? p.input * 1.25) + r.cache_write_1h * (p.cacheWrite1h ?? p.input * 2)) * mult) / 1e6
  }
  return mix
}

function priceAs(rows: UsageSums[], pricing: Pricing, model: string): number {
  return rows.reduce(
    (s, r) =>
      s +
      (pricing.cost(model, {
        input: r.input, output: r.output, cacheRead: r.cache_read, cacheWrite5m: r.cache_write_5m,
        cacheWrite1h: r.cache_write_1h, webSearch: 0, fast: false,
      }) ?? 0),
    0,
  )
}

const PREMIUM = /^claude-(opus|fable|mythos)/
const CHEAPER_MODEL = 'claude-sonnet-5-5'

const PERIOD: Record<RangeKey, { lead: string; inline: string }> = {
  week: { lead: 'Bu hafta', inline: 'bu hafta' },
  '30d': { lead: 'Son 30 günde', inline: 'son 30 günde' },
  all: { lead: 'Şimdiye kadar', inline: 'şimdiye kadar' },
}

function suggestions(db: Db, pricing: Pricing, from: string, to: string, periodCost: number, key: RangeKey): Suggestion[] {
  const period = PERIOD[key]
  const out: Suggestion[] = []

  const side = sums(db, 'is_sidechain = 1 AND day BETWEEN ? AND ?', from, to).filter((r) => PREMIUM.test(normalizeModel(r.model)))
  const sideCost = side.reduce((s, r) => s + r.cost, 0)
  const sideAlt = priceAs(side, pricing, CHEAPER_MODEL)
  if (sideCost - sideAlt >= 5) {
    out.push({
      saving: sideCost - sideAlt,
      text: `Subagent çağrıları ${period.inline} ${money(sideCost)} tuttu. Arama ve keşif gibi işlerde Sonnet 5.5 kullansalardı yaklaşık ${money(sideAlt)} olurdu.`,
    })
  }

  const big = n((db.prepare(`SELECT COALESCE(sum(cost), 0) AS c FROM api_calls
      WHERE day BETWEEN ? AND ? AND input + cache_read + cache_write_5m + cache_write_1h > ?`).get(from, to, BIG_CONTEXT) as Row).c)
  if (periodCost > 1 && big / periodCost >= 0.25) {
    out.push({
      saving: null,
      text: `${period.lead} maliyetin ${withPossessive((big / periodCost) * 100, '%')} context'i 200 bin token'ı aşan çağrılardan geldi. Uzun oturumları /compact ile özetlemek ya da yeni bir oturuma geçmek bu payı düşürür.`,
    })
  }

  const fast = sums(db, 'fast = 1 AND day BETWEEN ? AND ?', from, to)
  let premium = 0
  for (const r of fast) {
    const mult = pricing.prices[normalizeModel(r.model)]?.fastMultiplier ?? 1
    premium += r.cost - r.cost / mult
  }
  if (premium >= 1) out.push({ saving: premium, text: `Fast mode ${period.inline} ${money(premium)} fazladan tuttu.` })
  return out
}

/**
 * The day spend crosses the budget: the day it already did, or the day the current daily pace
 * reaches it, if that falls within this month.
 */
export function budgetCrossing(
  daily: { day: string; cost: number }[],
  budget: number,
  monthCost: number,
  elapsedDays: number,
  monthFirst: string,
  daysInMonth: number,
): string | null {
  if (monthCost >= budget) {
    let sum = 0
    for (const d of daily) {
      sum += d.cost
      if (sum >= budget) return d.day
    }
    return daily.at(-1)?.day ?? null
  }
  const rate = monthCost / elapsedDays
  if (rate <= 0) return null
  const days = budget / rate
  if (days > daysInMonth) return null
  // Calendar arithmetic, not milliseconds, so a DST change can't shift the day.
  return addDays(monthFirst, Math.floor(days))
}

/** Cost per day, or per week (keyed by its Monday) when the range is long. */
/** Cost per day, or per week past WEEKLY_AFTER_DAYS, split by model; optionally for one project. */
export function costSeries(db: Db, from: string, to: string, days: number, projectKey: string | null = null): CostReport['series'] {
  const weekly = days > WEEKLY_AFTER_DAYS
  const bucketOf = (day: string) => (weekly ? weekStart(day) : day)
  const points = new Map<string, DailyCost>()
  for (let d = bucketOf(from); d <= to; d = addDays(d, weekly ? 7 : 1)) points.set(d, { day: d, cost: 0, byModel: {} })
  const scope = projectKey === null ? '' : ' AND session_id IN (SELECT id FROM sessions WHERE project_key = $key)'
  const rows = db.prepare(`SELECT day, model, sum(cost) AS cost FROM api_calls WHERE day BETWEEN $from AND $to${scope} GROUP BY day, model`)
    .all(projectKey === null ? { $from: from, $to: to } : { $from: from, $to: to, $key: projectKey }) as Row[]
  for (const r of rows) {
    const e = points.get(bucketOf(String(r.day)))
    if (!e) continue
    const model = normalizeModel(String(r.model))
    e.cost += n(r.cost)
    e.byModel[model] = (e.byModel[model] ?? 0) + n(r.cost)
  }
  return { bucket: weekly ? 'week' : 'day', points: [...points.values()] }
}

export function costReport(
  db: Db,
  pricing: Pricing,
  account: AccountInfo | null,
  now = Date.now(),
  monthlyBudget: number | null = null,
  rangeKey: RangeKey = '30d',
): CostReport {
  const t = today()
  const range = rangeBounds(db, rangeKey)
  const { fromMs, ...rangeInfo } = range
  const costBetween = (a: string, b: string) => n((db.prepare('SELECT COALESCE(sum(cost), 0) AS c FROM api_calls WHERE day BETWEEN ? AND ?').get(a, b) as Row).c)

  // The calendar month, for the projection and the budget, whatever range is selected.
  const mb = monthBounds(t)
  const monthCost = costBetween(mb.first, t)
  const elapsedDays = Math.max(1, (now - mb.startMs) / DAY)
  const monthDaily = (db.prepare('SELECT day, sum(cost) AS cost FROM api_calls WHERE day BETWEEN ? AND ? GROUP BY day ORDER BY day').all(mb.first, t) as Row[]).map(
    (r) => ({ day: String(r.day), cost: n(r.cost) }),
  )

  const rows = sums(db, 'day BETWEEN ? AND ?', range.from, range.to)
  const total = rows.reduce((s, r) => s + r.cost, 0)
  const prev = previousBounds(range)

  // Counter runs that started in the range and own calls; see SessionRow.costHidden.
  const runs = db.prepare(`SELECT c.total_cost AS total,
      (SELECT COALESCE(sum(cost), 0) FROM api_calls a WHERE a.session_id = c.session_id AND a.ts >= c.start_time) AS run_cost,
      (SELECT count(*) FROM api_calls a WHERE a.session_id = c.session_id AND a.ts >= c.start_time) AS run_calls
    FROM cost_states c WHERE c.start_time >= ?`).all(fromMs) as Row[]
  const hidden = runs.filter((r) => n(r.run_calls) > 0).reduce((s, r) => s + Math.max(0, n(r.total) - n(r.run_cost)), 0)

  let cacheSavings = 0
  for (const r of rows) {
    const p = pricing.prices[normalizeModel(r.model)]
    if (p) cacheSavings += (r.cache_read * (p.input - p.cacheRead)) / 1e6
  }

  const byModel = new Map<string, ModelCost>()
  for (const r of rows) {
    const model = normalizeModel(r.model)
    const m = byModel.get(model) ?? { model, cost: 0, calls: 0, output: 0, share: 0 }
    m.cost += r.cost
    m.calls += r.calls
    m.output += r.output
    byModel.set(model, m)
  }
  const models = [...byModel.values()].map((m) => ({ ...m, share: total > 0 ? m.cost / total : 0 })).sort((a, b) => b.cost - a.cost)

  const projects = (db.prepare(`SELECT COALESCE(s.project_key, '?') AS key, COALESCE(s.project_name, 'Bilinmeyen') AS name, sum(a.cost) AS cost
      FROM api_calls a LEFT JOIN sessions s ON s.id = a.session_id WHERE a.day BETWEEN ? AND ?
      GROUP BY key ORDER BY cost DESC LIMIT 8`).all(range.from, range.to) as Row[]).map((r) => ({ key: String(r.key), name: String(r.name), cost: n(r.cost) }))

  return {
    range: rangeInfo,
    total,
    previous: prev ? costBetween(prev.from, prev.to) : null,
    hidden,
    cacheSavings,
    series: costSeries(db, range.from, range.to, range.days),
    models,
    mix: mixOf(rows, pricing),
    tokens: rows.reduce(
      (t, r) => ({
        input: t.input + r.input, output: t.output + r.output,
        cacheRead: t.cacheRead + r.cache_read, cacheWrite: t.cacheWrite + r.cache_write_5m + r.cache_write_1h,
      }),
      { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    ),
    projects,
    suggestions: suggestions(db, pricing, range.from, range.to, total, range.key),
    month: {
      from: mb.first, to: t, cost: monthCost,
      projected: (monthCost / elapsedDays) * mb.daysInMonth,
      lastMonth: costBetween(mb.prevFirst, mb.prevLast),
      lastMonthToDate: costBetween(mb.prevFirst, mb.prevToDate),
    },
    budget: monthlyBudget
      ? { monthly: monthlyBudget, crossesOn: budgetCrossing(monthDaily, monthlyBudget, monthCost, elapsedDays, mb.first, mb.daysInMonth) }
      : null,
    limits: limits(db, account, now),
  }
}

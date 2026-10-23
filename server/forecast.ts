// How full the usage limits are and when they fill. Anthropic reports the limits as percentages,
// not tokens. Readings of that percentage come from three places: the desktop app, which saves
// one about every 15 minutes while it runs; the Wiener Lens status line (bin/statusline.mjs),
// after every response in the terminal; and Claude Code's occasional reading in ~/.claude.json.
//
// Comparing how the percentage moved between two readings with the list price of the calls made
// in between gives "percent per dollar". With it, the percentage carries on from the last reading
// with what is spent locally, so it is there between readings too, and the percentage left turns
// into work left: in dollars, in time at the recent pace, and in prompts for a running session.
import fs from 'node:fs'
import path from 'node:path'
import type { LimitForecast, SessionForecast, WindowForecast } from '../shared/types.ts'
import { currentBlock } from './costs.ts'
import type { Db } from './db.ts'
import { dataDir } from './paths.ts'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const WEEK = 7 * DAY

export interface LimitSample {
  t: number
  session: string | null
  fh: number | null
  /** When the 5-hour window resets, in ms, when the reading says. */
  fr: number | null
  sd: number | null
  sr: number | null
}

/** Readings from one place, and the calls they should be compared with. */
export interface Stream {
  source: 'statusline' | 'desktop' | 'account'
  samples: LimitSample[]
  db: Db
}

export const samplesFile = (): string => path.join(dataDir(), 'limits.jsonl')

/** What the status line records is kept for this long; older lines are dropped as the file grows. */
const KEEP = 15 * DAY
const PRUNE_AT = 2_000_000

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const secs = (v: unknown) => (num(v) === null ? null : (v as number) * 1000)

export function readSamples(file = samplesFile(), now = Date.now()): LimitSample[] {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const out: LimitSample[] = []
  for (const line of text.split('\n')) {
    if (!line) continue
    try {
      const o = JSON.parse(line) as Record<string, unknown>
      const t = num(o.t)
      if (t === null || t < now - KEEP) continue
      out.push({ t, session: typeof o.s === 'string' ? o.s : null, fh: num(o.fh), fr: secs(o.fr), sd: num(o.sd), sr: secs(o.sr) })
    } catch {
      // A line cut short while being written.
    }
  }
  if (text.length > PRUNE_AT) {
    try {
      fs.writeFileSync(file, out.map((s) => `${JSON.stringify({ t: s.t, s: s.session, fh: s.fh, fr: s.fr && s.fr / 1000, sd: s.sd, sr: s.sr && s.sr / 1000 })}\n`).join(''))
    } catch {
      // Read-only data folder: keep reading the long file.
    }
  }
  return out.sort((a, b) => a.t - b.t)
}

/** Only readings from sessions this database knows: with one account picked, that account's. */
export function scopedSamples(db: Db, samples: LimitSample[]): LimitSample[] {
  const known = db.prepare('SELECT 1 FROM sessions WHERE id = ?')
  const seen = new Map<string, boolean>()
  return samples.filter((s) => {
    if (!s.session) return false
    let ok = seen.get(s.session)
    if (ok === undefined) seen.set(s.session, (ok = !!known.get(s.session)))
    return ok
  })
}

type Kind = 'fh' | 'sd'
const RESET: Record<Kind, 'fr' | 'sr'> = { fh: 'fr', sd: 'sr' }
/**
 * How far apart two readings may be and still be compared: close enough that a 5-hour window
 * can't have reset and filled again in between. Weekly resets show as a drop and are skipped.
 */
const MAX_GAP: Record<Kind, number> = { fh: 45 * MIN, sd: DAY }
/** A plan's limits rarely change; a month of readings gives the conversion more to go on. */
const CALIBRATE_FOR = 30 * DAY

/**
 * List-price spend of the calls made in (from, to], subagents included: they count toward the
 * limits too. A month of calls is read once per database and summed up front, so each of the many
 * reading pairs costs a binary search instead of a scan.
 */
const spenders = new WeakMap<Db, { at: number; ts: number[]; sums: number[] }>()
function spend(db: Db, from: number, to: number): number {
  let s = spenders.get(db)
  // Fresh for each request: a few seconds old at most, while the index keeps growing.
  if (!s || Date.now() - s.at > 2000) {
    const rows = db.prepare('SELECT ts, COALESCE(cost, 0) AS c FROM api_calls WHERE ts > ? ORDER BY ts').all(Date.now() - CALIBRATE_FOR - 2 * DAY) as { ts: number; c: number }[]
    const sums = [0]
    for (const r of rows) sums.push((sums[sums.length - 1] as number) + r.c)
    s = { at: Date.now(), ts: rows.map((r) => r.ts), sums }
    spenders.set(db, s)
  }
  // Index of the first call after t.
  const after = (t: number) => {
    let lo = 0
    let hi = s.ts.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if ((s.ts[mid] as number) <= t) lo = mid + 1
      else hi = mid
    }
    return lo
  }
  return (s.sums[after(to)] as number) - (s.sums[after(from)] as number)
}

/**
 * Percentage points per list-price dollar, pooled over pairs of readings close together in the
 * same window: how much the percentage rose against what the calls in between cost. A drop means
 * the window reset in between, so that pair is left out. Usage the computer doesn't see (claude.ai
 * chats) raises the percentage too, which makes the figure a little high.
 */
export function percentPerDollar(streams: Stream[], kind: Kind, now = Date.now()): number | null {
  let points = 0
  let dollars = 0
  for (const { samples, db } of streams) {
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1] as LimitSample
      const b = samples[i] as LimitSample
      const pa = a[kind]
      const pb = b[kind]
      const reset = RESET[kind]
      if (pa === null || pb === null || pb < pa || b.t - a.t > MAX_GAP[kind] || b.t < now - CALIBRATE_FOR) continue
      if (a[reset] !== null && b[reset] !== null && a[reset] !== b[reset]) continue
      points += pb - pa
      dollars += spend(db, a.t, b.t)
    }
  }
  return points >= 1 && dollars >= 0.5 ? points / dollars : null
}

/**
 * When the weekly window resets next. Readings that carry it say so; otherwise a reset seen in the
 * desktop app's readings (the percentage falling back) repeats every seven days.
 */
export function weeklyReset(streams: Stream[], now: number): number | null {
  let anchor: number | null = null
  for (const { samples } of streams) {
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i] as LimitSample
      if (s.sr !== null) anchor = Math.max(anchor ?? 0, s.sr)
      const prev = samples[i - 1]
      if (prev && prev.sd !== null && s.sd !== null && s.sd < prev.sd - 5) anchor = Math.max(anchor ?? 0, s.t)
    }
  }
  if (anchor === null) return null
  return anchor > now ? anchor : anchor + Math.ceil((now - anchor) / WEEK) * WEEK
}

/** The newest reading of a window, across all the places readings come from. */
function latest(streams: Stream[], kind: Kind): { sample: LimitSample; stream: Stream } | null {
  let best: { sample: LimitSample; stream: Stream } | null = null
  for (const stream of streams) {
    for (let i = stream.samples.length - 1; i >= 0; i--) {
      const sample = stream.samples[i] as LimitSample
      if (sample[kind] === null) continue
      if (!best || sample.t > best.sample.t) best = { sample, stream }
      break
    }
  }
  return best
}

/** A reading this recent stands as measured; past it, local spending carries it forward. */
const MEASURED_FOR = 10 * MIN

function windowForecast(streams: Stream[], kind: Kind, now: number): WindowForecast | null {
  const last = latest(streams, kind)
  if (!last) return null
  const { sample, stream } = last
  const db = stream.db
  const perDollar = percentPerDollar(streams, kind, now)
  const read = sample[kind] as number

  // The window now: when it started and resets, from the reading if it says, else from local activity.
  let start: number | null
  let resetsAt: number | null
  if (kind === 'fh') {
    if (sample.fr !== null && sample.fr > now) {
      resetsAt = sample.fr
      start = sample.fr - 5 * HOUR
    } else {
      const ts = (db.prepare('SELECT ts FROM api_calls WHERE ts >= ? ORDER BY ts').all(now - 2 * DAY) as { ts: number }[]).map((r) => r.ts)
      const block = currentBlock(ts, now)
      start = block?.start ?? null
      resetsAt = block?.end ?? null
    }
  } else {
    resetsAt = sample.sr !== null && sample.sr > now ? sample.sr : weeklyReset(streams, now)
    start = resetsAt !== null ? resetsAt - WEEK : null
  }

  let percent: number
  let estimated = false
  // A weekly reading from before the last possible reset says nothing about this week.
  if (kind === 'sd' && start === null && now - sample.t > WEEK) return null
  if (now - sample.t <= MEASURED_FOR) {
    percent = read
  } else if (perDollar === null) {
    // Without the conversion an old reading can't be carried forward.
    return null
  } else if (start === null) {
    // No activity in the last five hours: whatever window there was has reset.
    if (kind === 'fh') return { percent: 0, estimated: true, resetsAt: null, measuredAt: sample.t, source: stream.source, pace: 0, fillsAt: null, atReset: null, leftUsd: 100 / perDollar }
    percent = read + perDollar * spend(db, sample.t, now)
    estimated = true
  } else {
    percent = sample.t >= start ? read + perDollar * spend(db, sample.t, now) : perDollar * spend(db, start, now)
    estimated = true
  }
  percent = Math.min(100, percent)

  // The pace: the last hour for the 5-hour window, the last three days for the weekly one.
  const lookback = kind === 'fh' ? HOUR : 3 * DAY
  const from = Math.max(now - lookback, start ?? 0)
  const pace = perDollar !== null && now > from ? ((perDollar * spend(db, from, now)) / (now - from)) * HOUR : null
  let fillsAt: number | null = null
  let atReset: number | null = null
  if (pace !== null && pace > 0) {
    const at = now + ((100 - percent) / pace) * HOUR
    if (resetsAt === null || at < resetsAt) fillsAt = at
    else atReset = Math.min(100, percent + (pace * (resetsAt - now)) / HOUR)
  }
  return {
    percent, estimated, resetsAt, measuredAt: sample.t, source: stream.source, pace, fillsAt, atReset,
    leftUsd: perDollar !== null ? Math.max(0, (100 - percent) / perDollar) : null,
  }
}

export function limitForecast(streams: Stream[], now = Date.now()): LimitForecast {
  const reading = Math.max(0, ...streams.flatMap((s) => s.samples.map((x) => x.t)))
  return {
    lastReadingAt: reading || null,
    fiveHour: windowForecast(streams, 'fh', now),
    sevenDay: windowForecast(streams, 'sd', now),
  }
}

/** The middle and the upper quartile of a list of numbers. */
function quartiles(xs: number[]): { median: number; upper: number } {
  const s = [...xs].sort((a, b) => a - b)
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))] as number
  return { median: at(0.5), upper: at(0.75) }
}

/**
 * Roughly how many more prompts like its recent ones a session can send before the nearer limit
 * fills: the dollars left, divided by what its last prompts cost.
 */
export function sessionForecast(db: Db, sessionId: string, forecast: LimitForecast, now = Date.now()): SessionForecast | null {
  const left = [
    forecast.fiveHour?.leftUsd != null ? { limit: 'five_hour' as const, usd: forecast.fiveHour.leftUsd } : null,
    forecast.sevenDay?.leftUsd != null ? { limit: 'seven_day' as const, usd: forecast.sevenDay.leftUsd } : null,
  ].filter((x) => x !== null).sort((a, b) => a.usd - b.usd)[0]
  if (!left) return null
  const prompts = (db.prepare(`SELECT ts FROM prompts WHERE session_id = ? AND kind = 'prompt' AND ts >= ? ORDER BY ts DESC LIMIT 7`)
    .all(sessionId, now - 2 * DAY) as { ts: number }[]).map((r) => r.ts).reverse()
  const cost = db.prepare('SELECT COALESCE(sum(cost), 0) AS c FROM api_calls WHERE session_id = ? AND ts > ? AND ts <= ?')
  const costs: number[] = []
  for (let i = 0; i < prompts.length; i++) {
    const from = (prompts[i] as number) - 1
    const next = prompts[i + 1]
    // The prompt in progress has only part of its cost so far; it counts once it is done.
    if (next === undefined && now - from < 10 * MIN) break
    const c = (cost.get(sessionId, from, next === undefined ? now : next - 1) as { c: number }).c
    if (c > 0) costs.push(c)
  }
  if (costs.length < 2) return null
  const { median, upper } = quartiles(costs)
  const high = Math.floor(left.usd / median)
  const low = Math.min(high, Math.floor(left.usd / upper))
  return { sessionId, limit: left.limit, low, high, perPrompt: median }
}

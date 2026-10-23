import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDb } from '../server/db.ts'
import { type Stream, limitForecast, percentPerDollar, readSamples, sessionForecast, weeklyReset } from '../server/forecast.ts'
import { Indexer } from '../server/indexer.ts'
import { Pricing } from '../server/pricing.ts'
import { jsonl, prompt, reply, tempProjects, text } from './fixtures.ts'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const T0 = Date.parse('2026-10-20T10:00:00Z')
const iso = (ms: number) => new Date(ms).toISOString()

/**
 * Four prompts ten minutes apart, each answered by one call of 50k output tokens on Opus 5.5:
 * $1.00 each at list price. The status line read the 5-hour window after every answer.
 */
async function setup() {
  const fx = tempProjects()
  const records = [0, 10, 20, 30].flatMap((m, i) => [
    prompt(`adım ${i + 1}`, { ts: iso(T0 + m * MIN) }),
    reply(`m${i}`, text('tamam'), { input: 0, output: 50_000, read: 0 }, { ts: iso(T0 + (m + 1) * MIN) }),
  ])
  fx.write('-Users-me-code-app/s1.jsonl', jsonl(records))
  const db = openDb(':memory:')
  await new Indexer(db, new Pricing(), { projectsDir: fx.root, desktopDir: null }).scan()
  const reset = (T0 + 3 * HOUR) / 1000
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wiener-limits-')), 'limits.jsonl')
  fs.writeFileSync(file, jsonl([10, 14, 18, 22].map((fh, i) => ({ t: T0 + (i * 10 + 2) * MIN, s: 's1', fh, fr: reset, sd: 40 + i, sr: reset + 3 * 86_400 }))))
  const now = T0 + 33 * MIN
  return { db, now, statusLine: (): Stream[] => [{ source: 'statusline', samples: readSamples(file, now), db }] }
}

/** The desktop app's kind of reading: no reset times, every ten minutes here. */
const desktop = (db: Stream['db'], rows: [number, number | null, number | null][]): Stream => ({
  source: 'desktop', db, samples: rows.map(([m, fh, sd]) => ({ t: T0 + m * MIN, session: null, fh, fr: null, sd, sr: null })),
})

describe('limit forecast', () => {
  it('learns how many percentage points a dollar of calls moves the window', async () => {
    const { db, now, statusLine } = await setup()
    // 4 points for every $1 of calls between readings.
    expect(percentPerDollar(statusLine(), 'fh', now)).toBeCloseTo(4, 3)
    expect(percentPerDollar([desktop(db, [[2, 10, null], [12, 14, null], [22, 18, null]])], 'fh', now)).toBeCloseTo(4, 3)
  })

  it('turns the percentage left into dollars, pace and where the window ends up', async () => {
    const { db, now, statusLine } = await setup()
    const f = limitForecast(statusLine(), now)
    expect(f.fiveHour).toMatchObject({ percent: 22, estimated: false, source: 'statusline' })
    expect(f.fiveHour?.leftUsd).toBeCloseTo(78 / 4, 2)
    // $4 of calls in the last hour at 4 points a dollar: it won't fill before the reset at 13:00.
    expect(f.fiveHour?.pace).toBeCloseTo(16, 3)
    expect(f.fiveHour?.fillsAt).toBeNull()
    expect(f.fiveHour?.atReset).toBeCloseTo(22 + 16 * (147 / 60), 1)
    expect(db).toBeTruthy()
  })

  it('says when the window fills when that comes first', async () => {
    const { db, now } = await setup()
    // The same pace from 70%: full well before the reset.
    const f = limitForecast([desktop(db, [[2, 58, null], [12, 62, null], [22, 66, null], [32, 70, null]])], now)
    expect(f.fiveHour?.fillsAt).not.toBeNull()
    expect(f.fiveHour!.fillsAt! - now).toBeLessThan(2 * HOUR)
  })

  it('carries an older desktop reading forward with what was spent since', async () => {
    const { db } = await setup()
    // Last reading at 10:22 said 18%; the call at 10:31 cost $1, worth 4 points.
    const f = limitForecast([desktop(db, [[2, 10, null], [12, 14, null], [22, 18, null]])], T0 + 40 * MIN)
    expect(f.fiveHour).toMatchObject({ estimated: true, source: 'desktop' })
    expect(f.fiveHour?.percent).toBeCloseTo(22, 3)
    // The window started with the first call, at 10:00, and resets at 15:00.
    expect(f.fiveHour?.resetsAt).toBe(T0 + 5 * HOUR)
  })

  it('starts a fresh window at zero once five quiet hours have passed', async () => {
    const { db } = await setup()
    const f = limitForecast([desktop(db, [[2, 10, null], [12, 14, null], [22, 18, null]])], T0 + 7 * HOUR)
    expect(f.fiveHour).toMatchObject({ percent: 0, estimated: true, pace: 0 })
  })

  it('finds the weekly reset from a drop in the readings', async () => {
    const { db } = await setup()
    const s = desktop(db, [[0, null, 80], [15, null, 2]])
    // Reset seen at 10:15; a week later it comes round again.
    expect(weeklyReset([s], T0 + DAY)).toBe(T0 + 15 * MIN + 7 * DAY)
  })

  it('starts the next week at zero when nothing ran since its reset', async () => {
    const { now, statusLine } = await setup()
    const week = limitForecast(statusLine(), now + 8 * DAY).sevenDay
    // The reading said the week resets at 13:00 three days on; a week after that is the next one.
    expect(week).toMatchObject({ percent: 0, estimated: true, resetsAt: T0 + 3 * HOUR + 10 * DAY })
  })

  it('counts the prompts a running session has left, leaving out the one in progress', async () => {
    const { db, now, statusLine } = await setup()
    const s = sessionForecast(db, 's1', limitForecast(statusLine(), now), now)
    // $19.50 left at $1 a prompt; the weekly window has no dollar figure yet, so the 5-hour one decides.
    expect(s).toMatchObject({ limit: 'five_hour', low: 19, high: 19 })
    expect(s?.perPrompt).toBeCloseTo(1, 3)
  })
})

describe('status line script', () => {
  const script = path.resolve('bin/statusline.mjs')
  const run = (dir: string, input: unknown, args: string[] = []) =>
    spawnSync(process.execPath, [script, ...args], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, WIENER_DATA_DIR: dir, LANG: 'en_US.UTF-8' } })
  const reading = { session_id: 's1', cost: { total_cost_usd: 1.5 }, rate_limits: { five_hour: { used_percentage: 23.5, resets_at: 1_900_000_000 }, seven_day: { used_percentage: 41, resets_at: 1_900_300_000 } } }

  it('records a reading once and prints the windows', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiener-sl-'))
    const first = run(dir, reading)
    run(dir, reading)
    expect(first.stdout).toMatch(/^5h 24%, resets \d\d:\d\d · week 41%$/)
    const lines = fs.readFileSync(path.join(dir, 'limits.jsonl'), 'utf8').trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0] as string)).toMatchObject({ s: 's1', fh: 23.5, fr: 1_900_000_000, sd: 41, c: 1.5 })
  })

  it('passes the input to your own status line and prints its output instead', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiener-sl-'))
    const res = run(dir, reading, ['--', 'node', '-e', '"process.stdin.on(\'data\', (d) => process.stdout.write(\'own:\' + JSON.parse(d).session_id))"'])
    expect(res.stdout).toBe('own:s1')
    expect(fs.existsSync(path.join(dir, 'limits.jsonl'))).toBe(true)
  })

  it('stays quiet without limit data', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiener-sl-'))
    expect(run(dir, { session_id: 's1' }).stdout).toBe('')
    expect(fs.existsSync(path.join(dir, 'limits.jsonl'))).toBe(false)
  })
})

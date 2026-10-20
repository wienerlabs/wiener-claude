import { describe, expect, it } from 'vitest'
import { costReport } from '../server/costs.ts'
import { openDb } from '../server/db.ts'
import { Indexer } from '../server/indexer.ts'
import { Pricing } from '../server/pricing.ts'
import { projectList } from '../server/projects.ts'
import * as q from '../server/queries.ts'
import { previousBounds, rangeBounds } from '../server/range.ts'
import { addDays, dayKey, today, weekStart } from '../server/time.ts'
import { jsonl, prompt, reply, tempProjects, text } from './fixtures.ts'

/** Noon, local time, `n` days before today, as an ISO string. */
const daysAgo = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(12, 0, 0, 0)
  return d.toISOString()
}
// One million output tokens on Opus 5.5 cost $20.
const spend = (id: string, ts: string, sessionId = 's1') => reply(id, text('x'), { input: 0, read: 0, output: 1_000_000 }, { ts, sessionId })

async function setup(records: Record<string, unknown[]>) {
  const fx = tempProjects()
  for (const [file, rows] of Object.entries(records)) fx.write(file, jsonl(rows))
  const db = openDb(':memory:')
  const pricing = new Pricing()
  await new Indexer(db, pricing, { projectsDir: fx.root, desktopDir: null }).scan()
  return { db, pricing }
}

describe('range bounds', () => {
  it('starts the week on Monday, the 30 days 29 days back, and "all" on the first recorded day', async () => {
    const { db } = await setup({ '-a/s1.jsonl': [prompt('first', { ts: daysAgo(200) })] })
    const t = today()
    expect(rangeBounds(db, 'week')).toMatchObject({ from: weekStart(t), to: t })
    expect(rangeBounds(db, '30d')).toMatchObject({ from: addDays(t, -29), to: t, days: 30 })
    expect(rangeBounds(db, 'all')).toMatchObject({ from: dayKey(new Date(daysAgo(200))), days: 201 })
  })

  it('compares a week with the same weekdays of last week, and 30 days with the 30 before them', () => {
    expect(previousBounds({ key: 'week', from: '2026-10-19', to: '2026-10-21', days: 3 })).toEqual({ from: '2026-10-12', to: '2026-10-14' })
    expect(previousBounds({ key: '30d', from: '2026-09-22', to: '2026-10-21', days: 30 })).toEqual({ from: '2026-08-23', to: '2026-09-21' })
    expect(previousBounds({ key: 'all', from: '2026-01-01', to: '2026-10-21', days: 294 })).toBeNull()
  })
})

describe('filtering by range', () => {
  it('sums cost for the range, compares with the previous period, and goes weekly for long ranges', async () => {
    const { db, pricing } = await setup({
      '-a/s1.jsonl': [prompt('go', { ts: daysAgo(0) }), spend('m1', daysAgo(0)), spend('m2', daysAgo(10)), spend('m3', daysAgo(40)), spend('m4', daysAgo(150))],
    })
    const last30 = costReport(db, pricing, null, Date.now(), null, '30d')
    expect(last30.total).toBeCloseTo(40, 6)
    expect(last30.previous).toBeCloseTo(20, 6)
    const all = costReport(db, pricing, null, Date.now(), null, 'all')
    expect(all.total).toBeCloseTo(80, 6)
    expect(all.previous).toBeNull()
    expect(all.series.bucket).toBe('week')
    expect(all.series.points.reduce((s, p) => s + p.cost, 0)).toBeCloseTo(80, 6)
    expect(all.series.points.every((p) => new Date(`${p.day}T12:00:00`).getDay() === 1)).toBe(true)
  })

  it('lists only sessions active in the range, and only projects with activity in it', async () => {
    const { db } = await setup({
      '-Users-me-new/recent.jsonl': [prompt('yeni', { sessionId: 'recent', cwd: '/Users/me/new', ts: daysAgo(1) })],
      '-Users-me-old/old.jsonl': [prompt('eski', { sessionId: 'old', cwd: '/Users/me/old', ts: daysAgo(60) })],
    })
    expect(q.sessions(db, { range: '30d' }).rows.map((r) => r.id)).toEqual(['recent'])
    expect(q.sessions(db, { range: 'all' }).rows.map((r) => r.id)).toEqual(['recent', 'old'])
    expect(projectList(db, '30d').map((p) => p.name)).toEqual(['new'])
    expect(projectList(db, 'all').map((p) => p.name)).toEqual(['new', 'old'])
  })

  it('totals messages and tokens by kind for the week, the last 30 days and all time', async () => {
    const usage = { input: 10, output: 200, read: 3_000, write1h: 400, write5m: 50 }
    const { db } = await setup({
      '-a/s1.jsonl': [
        prompt('a', { ts: daysAgo(0) }), reply('m1', text('x'), usage, { ts: daysAgo(0) }),
        prompt('b', { ts: daysAgo(20) }), reply('m2', text('x'), usage, { ts: daysAgo(20) }),
        prompt('c', { ts: daysAgo(90) }), reply('m3', text('x'), usage, { ts: daysAgo(90) }),
      ],
    })
    const [week, month, all] = q.summary(db, []).periods
    expect(week).toMatchObject({ key: 'week', messages: 2, input: 10, output: 200, cacheRead: 3_000, cacheWrite: 450 })
    expect(month).toMatchObject({ key: '30d', messages: 4, input: 20, output: 400, cacheRead: 6_000, cacheWrite: 900 })
    expect(all).toMatchObject({ key: 'all', messages: 6, input: 30, output: 600, cacheRead: 9_000, cacheWrite: 1_350 })
    expect(all?.cost).toBeGreaterThan(month?.cost ?? 0)
  })

  it('switches the project heatmap to weekly columns for long ranges', async () => {
    const { db } = await setup({ '-Users-me-a/s1.jsonl': [prompt('a', { cwd: '/Users/me/a', ts: daysAgo(120) }), prompt('b', { cwd: '/Users/me/a', ts: daysAgo(2) })] })
    const all = rangeBounds(db, 'all')
    const h = q.heatmap(db, 'project', 'messages', all.from, all.to)
    expect(h.bucket).toBe('week')
    expect(h.columns[0]).toBe(weekStart(all.from))
    expect(h.cells.reduce((s, c) => s + c.value, 0)).toBe(2)
    expect(h.cells.every((c) => h.columns.includes(c.key.split('|')[1] as string))).toBe(true)
    const month = rangeBounds(db, '30d')
    expect(q.heatmap(db, 'project', 'messages', month.from, month.to)).toMatchObject({ bucket: 'day' })
  })
})

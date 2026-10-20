// The public demo: response file names, and the made-up data it is built from.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateDemoHome } from '../scripts/demo/generate.ts'
import { openDb } from '../server/db.ts'
import { Indexer } from '../server/indexer.ts'
import { Pricing } from '../server/pricing.ts'
import * as q from '../server/queries.ts'
import { tipsReport } from '../server/tips.ts'
import { demoFile } from '../shared/demo.ts'

describe('demo files', () => {
  it('names a response by its path and query, whatever the parameter order', () => {
    expect(demoFile('/api/heatmap?view=project&metric=cost&range=30d')).toBe(demoFile('/api/heatmap?range=30d&metric=cost&view=project'))
    expect(demoFile('/api/heatmap?view=project&metric=cost')).not.toBe(demoFile('/api/heatmap?view=project&metric=tokens'))
    expect(demoFile('/api/projects/%2FUsers%2Fdemo%2Fcode%2Fapp?range=all')).toMatch(/^projects-[0-9a-f]{8}\.json$/)
  })
})

describe('demo data', () => {
  it('fills every screen without going past what the session list can hold', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wiener-demo-test-'))
    generateDemoHome({ home, now: new Date(2026, 9, 21, 15, 0) })
    const db = openDb(':memory:')
    const pricing = new Pricing()
    await new Indexer(db, pricing, { projectsDir: path.join(home, '.claude', 'projects'), desktopDir: null }).scan()

    const list = q.sessions(db, { range: 'all', limit: 200 })
    expect(list.total).toBeGreaterThan(25)
    expect(list.total).toBeLessThan(200)
    expect(new Set(list.rows.map((r) => r.projectName))).toEqual(new Set(['carsi-web', 'carsi-payments', 'carsi-mobile', 'carsi-data', 'carsi-infra', 'carsi-docs']))

    const kinds = tipsReport(db, pricing, '30d', { instructions: [], mcp: [] }).tips.map((t) => t.kind)
    expect(kinds).toEqual(expect.arrayContaining(['cache-rewrite', 'repeated-prompts', 'setup-errors']))

    // Same seed, same data.
    const again = fs.mkdtempSync(path.join(os.tmpdir(), 'wiener-demo-test-'))
    generateDemoHome({ home: again, now: new Date(2026, 9, 21, 15, 0) })
    // Folder names carry the home path; the transcripts' own names come from the seed.
    const files = (dir: string) => fs.readdirSync(path.join(dir, '.claude', 'projects'), { recursive: true }).map(String).filter((f) => f.endsWith('.jsonl')).map((f) => path.basename(f)).sort()
    expect(files(again)).toEqual(files(home))
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(again, { recursive: true, force: true })
  })
})

describe('demo data in English', () => {
  it('describes the same sessions as the Turkish data, in English', async () => {
    const now = new Date(2026, 9, 21, 15, 0)
    const index = async (lang: 'tr' | 'en') => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wiener-demo-test-'))
      generateDemoHome({ home, now, lang })
      const db = openDb(':memory:')
      await new Indexer(db, new Pricing(), { projectsDir: path.join(home, '.claude', 'projects'), desktopDir: null }).scan()
      fs.rmSync(home, { recursive: true, force: true })
      return q.sessions(db, { range: 'all', limit: 200 }).rows
    }
    const tr = await index('tr')
    const en = await index('en')
    const shape = (rows: typeof tr) => rows.map((r) => ({ id: r.id, project: r.projectName, start: r.firstTs, end: r.lastTs, messages: r.messages, cost: r.costEstimate, added: r.linesAdded }))
    expect(shape(en)).toEqual(shape(tr))
    expect(en.map((r) => r.title)).not.toEqual(tr.map((r) => r.title))
    for (const r of en) expect(r.title).not.toMatch(/[çğıöşüÇĞİÖŞÜ]/)
  })
})

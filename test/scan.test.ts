import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDb } from '../server/db.ts'
import { Indexer, discover } from '../server/indexer.ts'
import { Pricing } from '../server/pricing.ts'
import { jsonl, prompt, tempProjects } from './fixtures.ts'

describe('scanning stays cheap', () => {
  it('finds main and nested subagent transcripts, and skips other session folders', async () => {
    const fx = tempProjects()
    fx.write('-a/s1.jsonl', jsonl([prompt('x')]))
    fx.write('-a/s1/subagents/agent-1.jsonl', jsonl([prompt('y')]))
    fx.write('-a/s1/subagents/workflows/wf_1/agent-2.jsonl', jsonl([prompt('z')]))
    fx.write('-a/s1/tool-results/big.jsonl', jsonl([prompt('not a transcript')]))
    const found = await discover(fx.root)
    expect(found.map((f) => [path.relative(fx.root, f.path), f.sessionId, f.isSubagent])).toEqual([
      ['-a/s1.jsonl', 's1', false],
      ['-a/s1/subagents/agent-1.jsonl', 's1', true],
      ['-a/s1/subagents/workflows/wf_1/agent-2.jsonl', 's1', true],
    ])
  })

  it('reports a desktop change only when something shown changed, not on an activity bump', async () => {
    const fx = tempProjects()
    const desktop = fs.mkdtempSync(path.join(os.tmpdir(), 'wiener-desktop-'))
    const file = path.join(desktop, 'acct', 'org', 'local_1.json')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const write = (o: Record<string, unknown>, mtime: number) => {
      fs.writeFileSync(file, JSON.stringify({ cliSessionId: 's1', title: 'İlk', lastActivityAt: 1, ...o }))
      fs.utimesSync(file, mtime, mtime)
    }
    const db = openDb(':memory:')
    const ix = new Indexer(db, new Pricing(), { projectsDir: fx.root, desktopDir: desktop })
    const title = () => (db.prepare('SELECT title FROM desktop_sessions').get() as { title: string } | undefined)?.title

    write({}, 1000)
    expect(await ix.scan()).toBe(true)
    expect(title()).toBe('İlk')
    write({ lastActivityAt: 999 }, 2000)
    expect(await ix.scan()).toBe(false)
    write({ title: 'Yeni ad' }, 3000)
    expect(await ix.scan()).toBe(true)
    expect(title()).toBe('Yeni ad')
    fs.rmSync(file)
    expect(await ix.scan()).toBe(true)
    expect(title()).toBeUndefined()
  })
})

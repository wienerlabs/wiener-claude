import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { costReport, currentBlock, limits, planName, readAccount } from '../server/costs.ts'
import { openDb } from '../server/db.ts'
import { Indexer } from '../server/indexer.ts'
import { hunkCounts, normalizeEditPath, parseLine } from '../server/parse.ts'
import { Pricing } from '../server/pricing.ts'
import { projectDetail, projectList } from '../server/projects.ts'
import * as q from '../server/queries.ts'
import { turnBuilder } from '../server/replay.ts'
import { ftsQuery, hitRanges, snippetFrom } from '../server/search.ts'
import { jsonl, prompt, reply, tempProjects, text, toolResult, toolUse } from './fixtures.ts'

const main = { fileSessionId: 's1', isSubagent: false }
const SLUG = '-Users-me-code-app'
const hunk = (lines: string[]) => ({ oldStart: 1, oldLines: 0, newStart: 1, newLines: 0, lines })

function setup() {
  const fx = tempProjects()
  const db = openDb(':memory:')
  const pricing = new Pricing()
  const indexer = new Indexer(db, pricing, { projectsDir: fx.root, desktopDir: null })
  return { fx, db, pricing, indexer }
}

describe('file edits', () => {
  it('counts added and removed lines from hunks', () => {
    expect(hunkCounts([hunk([' a', '-b', '+c', '+d']), hunk(['+e'])])).toEqual({ added: 3, removed: 1 })
    expect(hunkCounts([{ newLines: 4, oldLines: 2 }])).toEqual({ added: 4, removed: 2 })
  })

  it('ignores files in Claude Code scratch folders', () => {
    const r = toolResult('t1', 'ok', false, {
      extra: { toolUseResult: { type: 'create', filePath: '/private/tmp/claude-501/x/scratchpad/notes.md', content: 'a\n' } },
    })
    expect(parseLine(r, main).some((f) => f.kind === 'file_edit')).toBe(false)
  })

  it('folds worktree copies into the repository path', () => {
    expect(normalizeEditPath('/Users/me/code/app/.claude/worktrees/fix-9/src/a.ts')).toBe('/Users/me/code/app/src/a.ts')
  })

  it('reads Edit, Write and shell edits, but not git operations or failed calls', () => {
    const edit = toolResult('t1', 'ok', false, {
      extra: { toolUseResult: { filePath: '/r/a.ts', oldString: 'x', newString: 'y', structuredPatch: [hunk(['-x', '+y', '+z'])] } },
    })
    const create = toolResult('t2', 'ok', false, { extra: { toolUseResult: { type: 'create', filePath: '/r/b.ts', content: 'one\ntwo\nthree\n' } } })
    const bash = toolResult('t3', 'ok', false, {
      extra: { toolUseResult: { stdout: '', bashEditDiff: { files: [{ filePath: '/r/c.ts', hunks: [hunk(['+1'])] }] } } },
    })
    const git = toolResult('t4', 'ok', false, {
      extra: { toolUseResult: { stdout: '', gitOperation: { type: 'checkout' }, bashEditDiff: { files: [{ filePath: '/r/d.ts', hunks: [hunk(['+1'])] }] } } },
    })
    const failed = toolResult('t5', 'boom', true, { extra: { toolUseResult: { filePath: '/r/e.ts', structuredPatch: [hunk(['+1'])] } } })
    const edits = [edit, create, bash, git, failed].flatMap((r) => parseLine(r, main)).filter((f) => f.kind === 'file_edit')
    expect(edits).toEqual([
      expect.objectContaining({ path: '/r/a.ts', tool: 'edit', added: 2, removed: 1 }),
      expect.objectContaining({ path: '/r/b.ts', tool: 'write', added: 3, removed: 0 }),
      expect.objectContaining({ path: '/r/c.ts', tool: 'bash', added: 1, removed: 0 }),
    ])
  })
})

describe('limit hits and searchable text', () => {
  it('records a rejected quota with its reset time in milliseconds', () => {
    const r = reply('m1', text('limit'), {}, {
      model: '<synthetic>',
      extra: { isApiErrorMessage: true, quotaLimits: { status: 'rejected', rateLimitType: 'seven_day', resetsAt: 1791612000 } },
    })
    expect(parseLine(r, main).find((f) => f.kind === 'limit_hit')).toMatchObject({ limitKind: 'seven_day', resetsAt: 1791612000000 })
  })

  it('indexes prompts, reply text and shell commands, but nothing from subagents', () => {
    const facts = [
      prompt('<system-reminder>x</system-reminder>Ödeme akışını düzelt'),
      reply('m1', text('Tamam, bakıyorum.')),
      reply('m1', toolUse('t1', 'Bash', { command: 'npm test -- payment' })),
    ].flatMap((r) => parseLine(r, main)).filter((f) => f.kind === 'text')
    expect(facts.map((f) => f.kind === 'text' && [f.textKind, f.text])).toEqual([
      ['prompt', 'Ödeme akışını düzelt'],
      ['reply', 'Tamam, bakıyorum.'],
      ['command', 'npm test -- payment'],
    ])
    const sub = { fileSessionId: 's1', isSubagent: true }
    expect(parseLine(reply('m2', text('agent notes')), sub).some((f) => f.kind === 'text')).toBe(false)
  })
})

describe('search', () => {
  it('quotes every word and makes it a prefix', () => {
    expect(ftsQuery('  ödeme "webhook* ')).toBe('"ödeme"* "webhook"*')
    expect(ftsQuery('NEAR(a b)')).toBe('"NEAR(a"* "b)"*')
    expect(ftsQuery('   ')).toBeNull()
  })

  it('marks hits in the original text the way the tokenizer folds it', () => {
    const original = 'Kısa bir not: ödeme webhook testi KIRILDI, İzmir şubesi değiştirildi.'
    const marked = (q: string) => snippetFrom(original, hitRanges(original, q))
    expect(marked('webhook')).toBe('Kısa bir not: ödeme \u0002webhook\u0003 testi KIRILDI, İzmir şubesi değiştirildi.')
    expect(marked('kisa kirildi')).toBe('\u0002Kısa\u0003 bir not: ödeme webhook testi \u0002KIRILDI\u0003, İzmir şubesi değiştirildi.')
    expect(marked('izmir subesi degis')).toContain('\u0002İzmir\u0003 \u0002şubesi\u0003 \u0002değiştirildi\u0003')
    expect(hitRanges(original, 'yok')).toEqual([])
  })

  it('keeps offsets right after characters that fold to nothing or change length', () => {
    const original = 'e\u0301 ve 😀 sonra hedef'
    const [range] = hitRanges(original, 'hedef')
    expect(range && original.slice(range[0], range[1])).toBe('hedef')
  })

  it('finds sessions without Turkish letters or accents and returns the hit to jump to', async () => {
    const { fx, db, indexer } = setup()
    fx.write(`${SLUG}/s1.jsonl`, jsonl([prompt('Kısa açıklamayı değiştir', { uuid: 'p-1' })]))
    fx.write(`${SLUG}/s2.jsonl`, jsonl([prompt('README güncelle', { sessionId: 's2' })]))
    await indexer.scan()
    for (const query of ['kisa', 'degistir', 'KISA aciklama']) {
      const res = q.sessions(db, { q: query })
      expect(res.rows.map((r) => r.id), query).toEqual(['s1'])
      expect(res.rows[0]?.match).toMatchObject({ key: 'p-1', kind: 'prompt', hits: 1 })
    }
    expect(q.sessions(db, { q: 'kisa' }).rows[0]?.match?.snippet).toBe('\u0002Kısa\u0003 açıklamayı değiştir')
  })

  it('maps a hit back to its turn', () => {
    const b = turnBuilder(new Pricing())
    for (const r of [
      prompt('one', { uuid: 'p1' }),
      reply('m1', text('a'), {}, { uuid: 'a1' }),
      prompt('two', { uuid: 'p2' }),
      reply('m2', toolUse('t9', 'Bash', { command: 'ls' }), {}, { uuid: 'a2' }),
    ]) b.add(r)
    const { keyIndex } = b.finish()
    expect([keyIndex.get('p1'), keyIndex.get('a1'), keyIndex.get('p2'), keyIndex.get('t9')]).toEqual([0, 0, 1, 1])
  })
})

describe('limits', () => {
  const H = 3_600_000
  it('finds the 5-hour window that contains now', () => {
    const t0 = Date.UTC(2026, 9, 20, 9, 40)
    expect(currentBlock([t0, t0 + H], t0 + 2 * H)).toEqual({ start: Date.UTC(2026, 9, 20, 9), end: Date.UTC(2026, 9, 20, 14) })
    expect(currentBlock([t0], t0 + 6 * H)).toBeNull()
    // A request after the window ended opens a new one on its own hour.
    expect(currentBlock([t0, t0 + 6 * H], t0 + 6 * H)?.start).toBe(Date.UTC(2026, 9, 20, 15))
  })

  it('names plans from the rate-limit tier', () => {
    expect(planName('default_claude_max_5x', null)).toBe('Max 5x')
    expect(planName('default_claude_max_20x', 'claude_max')).toBe('Max 20x')
    expect(planName(null, 'claude_pro')).toBe('Pro')
    expect(planName(null, null)).toBeNull()
  })

  it('reads only the plan and usage from the account file, and hides a stale reading', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wiener-acct-')), '.claude.json')
    const now = Date.now()
    const reading = (fetchedAtMs: number) => ({
      oauthAccount: { emailAddress: 'me@example.com', organizationRateLimitTier: 'default_claude_max_5x' },
      cachedUsageUtilization: {
        fetchedAtMs,
        utilization: {
          five_hour: { utilization: 42, resets_at: new Date(now + 2 * H).toISOString() },
          seven_day: { utilization: 80, resets_at: new Date(now + 48 * H).toISOString() },
        },
      },
    })
    fs.writeFileSync(file, JSON.stringify(reading(now - 10 * 60_000)))
    const fresh = readAccount(file)
    expect(JSON.stringify(fresh)).not.toContain('example.com')
    const db = openDb(':memory:')
    expect(limits(db, fresh, now).measured).toMatchObject({ fresh: true, fiveHour: { percent: 42 }, sevenDay: { percent: 80 } })

    fs.writeFileSync(file, JSON.stringify(reading(now - 40 * 24 * H)))
    fs.utimesSync(file, new Date(), new Date(now + 1000))
    expect(limits(db, readAccount(file), now).measured).toMatchObject({ fresh: false, fiveHour: null, sevenDay: null })
  })

  it('groups retries of one limit hit and measures spend in the week before it', async () => {
    const { fx, db, indexer } = setup()
    const hitAt = Date.parse('2026-10-09T08:53:52Z')
    const quota = { status: 'rejected', rateLimitType: 'seven_day', resetsAt: 1791612000 }
    fx.write(`${SLUG}/s1.jsonl`, jsonl([
      reply('m0', text('work'), { input: 0, read: 0, output: 1_000_000 }, { ts: '2026-10-08T10:00:00Z' }), // $20
      reply('x1', text('limit'), {}, { model: '<synthetic>', ts: '2026-10-09T08:53:52Z', extra: { isApiErrorMessage: true, quotaLimits: quota } }),
      reply('x2', text('limit'), {}, { model: '<synthetic>', ts: '2026-10-09T08:55:57Z', extra: { isApiErrorMessage: true, quotaLimits: quota } }),
    ]))
    await indexer.scan()
    const l = limits(db, null, Date.parse('2026-10-20T12:00:00Z'))
    expect(l.hits).toEqual([{ kind: 'seven_day', at: hitAt, resetsAt: 1791612000000 }])
    expect(l.rolling7.atLastWeeklyHit?.cost).toBeCloseTo(20, 6)
  })
})

describe('cost report and projects', () => {
  it('splits this month by model and token type, and the mix adds up to the total', async () => {
    const { fx, db, pricing, indexer } = setup()
    const ts = new Date().toISOString()
    fx.write(`${SLUG}/s1.jsonl`, jsonl([
      prompt('go', { ts }),
      reply('m1', text('a'), { input: 1000, output: 2000, read: 50_000, write1h: 3000 }, { ts }),
      reply('m2', text('b'), { input: 10, output: 500, read: 0 }, { ts, model: 'claude-haiku-4-5-20251001' }),
    ]))
    await indexer.scan()
    const r = costReport(db, pricing, null)
    expect(r.models.map((m) => m.model)).toEqual(['claude-opus-5-5', 'claude-haiku-4-5'])
    const mix = r.mix.input + r.mix.output + r.mix.cacheRead + r.mix.cacheWrite
    expect(mix).toBeCloseTo(r.month.cost, 9)
    // Cache reads saved the difference between the input and cache-read price.
    expect(r.cacheSavings).toBeCloseTo((50_000 * (4 - 0.2)) / 1e6, 9)
    expect(r.daily).toHaveLength(30)
    expect(r.daily.at(-1)?.cost).toBeCloseTo(r.month.cost, 9)
  })

  it('lists projects with their most edited files, merging worktree copies', async () => {
    const { fx, db, indexer } = setup()
    const editAt = (file: string, add: string[], o: { sessionId?: string; cwd?: string } = {}) =>
      toolResult(`t-${Math.random()}`, 'ok', false, {
        sessionId: o.sessionId, extra: { toolUseResult: { filePath: file, structuredPatch: [hunk(add)] } },
      })
    fx.write(`${SLUG}/s1.jsonl`, jsonl([
      prompt('go'),
      editAt('/Users/me/code/app/src/a.ts', ['+1', '+2']),
      editAt('/Users/me/code/app/src/b.ts', ['+1']),
    ]))
    fx.write(`${SLUG}--claude-worktrees-x/s2.jsonl`, jsonl([
      prompt('go', { sessionId: 's2', cwd: '/Users/me/code/app/.claude/worktrees/x' }),
      editAt('/Users/me/code/app/.claude/worktrees/x/src/a.ts', ['-1', '+3'], { sessionId: 's2' }),
    ]))
    await indexer.scan()
    const [p] = projectList(db)
    expect(p).toMatchObject({ key: '/Users/me/code/app', name: 'app', sessions: 2, topFiles: ['src/a.ts', 'src/b.ts'] })
    expect(p?.strip).toHaveLength(84)
    const d = projectDetail(db, '/Users/me/code/app')
    expect(d?.files[0]).toEqual(expect.objectContaining({ path: 'src/a.ts', edits: 2, added: 3, removed: 1, sessions: 2 }))
    expect(d).toMatchObject({ linesAdded: 4, linesRemoved: 1 })
    expect(projectDetail(db, '/nope')).toBeNull()
  })

  it('filters a heatmap to one project', async () => {
    const { fx, db, indexer } = setup()
    fx.write(`${SLUG}/s1.jsonl`, jsonl([prompt('a', { ts: '2026-10-05T10:00:00Z' })]))
    fx.write(`-Users-me-code-web/s2.jsonl`, jsonl([prompt('b', { sessionId: 's2', cwd: '/Users/me/code/web', ts: '2026-10-05T10:00:00Z' })]))
    await indexer.scan()
    expect(q.heatmap(db, 'calendar', 'messages', '2026-10-01', '2026-10-31').total).toBe(2)
    expect(q.heatmap(db, 'calendar', 'messages', '2026-10-01', '2026-10-31', '/Users/me/code/web').total).toBe(1)
  })
})

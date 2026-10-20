import { describe, expect, it } from 'vitest'
import { openDb } from '../server/db.ts'
import { Indexer } from '../server/indexer.ts'
import { Pricing } from '../server/pricing.ts'
import * as q from '../server/queries.ts'
import { buildTurns } from '../server/replay.ts'
import { costState, jsonl, prompt, reply, tempProjects, text, toolResult, toolUse } from './fixtures.ts'

function setup() {
  const fx = tempProjects()
  const db = openDb(':memory:')
  const pricing = new Pricing()
  const indexer = new Indexer(db, pricing, { projectsDir: fx.root, desktopDir: null })
  const count = (sql: string) => (db.prepare(sql).get() as { c: number }).c
  return { fx, db, pricing, indexer, count }
}

const SLUG = '-Users-me-code-app'

describe('Indexer', () => {
  it('counts a streamed response once, with its largest usage, even when its lines are not adjacent', async () => {
    const { fx, db, indexer, count } = setup()
    fx.write(`${SLUG}/s1.jsonl`, jsonl([
      prompt('hello'),
      reply('m1', text('part 1'), { output: 5 }),
      reply('m1', toolUse('t1', 'Bash', { command: 'ls' }), { output: 5 }),
      toolResult('t1', 'ok'),
      reply('m1', text('part 2'), { output: 80 }),
    ]))
    await indexer.scan()
    expect(count('SELECT count(*) c FROM api_calls')).toBe(1)
    expect(db.prepare('SELECT output FROM api_calls').get()).toEqual({ output: 80 })
    expect(count('SELECT count(*) c FROM prompts')).toBe(1)
    expect(count('SELECT count(*) c FROM tool_uses WHERE name = \'Bash\' AND is_error = 0')).toBe(1)
  })

  it('gives the same result whether a file is read at once or as it grows', async () => {
    const records = [
      prompt('one', { ts: '2026-10-01T10:00:00Z' }),
      reply('m1', toolUse('t1', 'Read', { file_path: '/x' }), { output: 10 }, { ts: '2026-10-01T10:00:01Z' }),
      toolResult('t1', 'boom', true, { ts: '2026-10-01T10:00:02Z' }),
      reply('m2', text('fixed'), { output: 30 }, { ts: '2026-10-01T10:00:03Z' }),
      reply('m2', text('more'), { output: 60 }, { ts: '2026-10-01T10:00:04Z' }),
      prompt('two', { ts: '2026-10-01T11:00:00Z' }),
    ]
    const whole = setup()
    whole.fx.write(`${SLUG}/s1.jsonl`, jsonl(records))
    await whole.indexer.scan()

    const grow = setup()
    const full = jsonl(records)
    // Split mid-line: the second scan must finish the half-written record.
    const cut = full.indexOf('"output":60') + 3
    grow.fx.write(`${SLUG}/s1.jsonl`, full.slice(0, cut))
    await grow.indexer.scan()
    grow.fx.append(`${SLUG}/s1.jsonl`, full.slice(cut))
    await grow.indexer.scan()

    for (const sql of [
      'SELECT count(*) c FROM prompts',
      'SELECT count(*) c FROM api_calls',
      'SELECT sum(output) c FROM api_calls',
      'SELECT count(*) c FROM tool_uses WHERE is_error = 1',
    ]) {
      expect(grow.count(sql), sql).toBe(whole.count(sql))
    }
    expect(grow.count('SELECT sum(output) c FROM api_calls')).toBe(70)
  })

  it('does not double count history copied into a forked session file', async () => {
    const { fx, indexer, count } = setup()
    const history = [prompt('orig', { uuid: 'p1', sessionId: 'orig' }), reply('m1', text('a'), {}, { sessionId: 'orig' })]
    fx.write(`${SLUG}/orig.jsonl`, jsonl(history))
    fx.write(`${SLUG}/fork.jsonl`, jsonl([...history, costState('fork', 1, 9.99)]))
    await indexer.scan()
    expect(count('SELECT count(*) c FROM api_calls')).toBe(1)
    expect(count('SELECT count(*) c FROM prompts')).toBe(1)
    expect(count("SELECT count(*) c FROM api_calls WHERE session_id = 'orig'")).toBe(1)
  })

  it('attributes a call to the copy that carries its usage, not to a zeroed copy read first', async () => {
    const { fx, db, indexer } = setup()
    // "a-…" sorts first, so its zeroed copy of m1 is indexed before the real one.
    fx.write(`${SLUG}/a-continued.jsonl`, jsonl([reply('m1', text('x'), { input: 0, output: 0, read: 0 }, { sessionId: 'a-continued' })]))
    fx.write(`${SLUG}/b-original.jsonl`, jsonl([reply('m1', text('x'), { output: 900 }, { sessionId: 'b-original' })]))
    await indexer.scan()
    expect(db.prepare('SELECT session_id, output FROM api_calls').all()).toEqual([{ session_id: 'b-original', output: 900 }])
  })

  it('adds subagent transcripts to the parent session as sidechain calls', async () => {
    const { fx, db, indexer } = setup()
    fx.write(`${SLUG}/s1.jsonl`, jsonl([prompt('go'), reply('m1', toolUse('t1', 'Agent', { description: 'explore' }))]))
    fx.write(`${SLUG}/s1/subagents/agent-1.jsonl`, jsonl([
      prompt('explore the repo', { sessionId: 's1', extra: { isSidechain: true } }),
      reply('m2', text('found it'), { output: 500 }, { sessionId: 's1', extra: { isSidechain: true } }),
    ]))
    fx.write(`${SLUG}/s1/subagents/workflows/wf_1/agent-2.jsonl`, jsonl([reply('m3', text('x'), {}, { sessionId: 'wf-run' })]))
    await indexer.scan()
    expect(db.prepare('SELECT msg_id, session_id, is_sidechain FROM api_calls ORDER BY msg_id').all()).toEqual([
      { msg_id: 'm1', session_id: 's1', is_sidechain: 0 },
      { msg_id: 'm2', session_id: 's1', is_sidechain: 1 },
      { msg_id: 'm3', session_id: 's1', is_sidechain: 1 },
    ])
    expect((db.prepare('SELECT count(*) c FROM prompts').get() as { c: number }).c).toBe(1)
  })

  it('rebuilds when a file is rewritten in place', async () => {
    const { fx, indexer, count } = setup()
    fx.write(`${SLUG}/s1.jsonl`, jsonl([prompt('a'), prompt('b'), prompt('c')]))
    await indexer.scan()
    expect(count('SELECT count(*) c FROM prompts')).toBe(3)
    fx.write(`${SLUG}/s1.jsonl`, jsonl([prompt('only')]))
    await indexer.scan()
    expect(count('SELECT count(*) c FROM prompts')).toBe(1)
  })

  it('keeps indexed history after Claude Code deletes a transcript', async () => {
    const { fx, indexer, count } = setup()
    const file = fx.write(`${SLUG}/old.jsonl`, jsonl([prompt('old work', { sessionId: 'old' })]))
    await indexer.scan()
    ;(await import('node:fs')).rmSync(file)
    await indexer.scan()
    expect(count('SELECT count(*) c FROM prompts')).toBe(1)
  })
})

describe('queries', () => {
  it('aggregates heatmaps by day, weekday-hour and project', async () => {
    const { fx, db, indexer } = setup()
    const at = (h: number, m = 0) => new Date(2026, 9, 5, h, m).toISOString() // Monday, local time
    fx.write(`${SLUG}/s1.jsonl`, jsonl([
      prompt('a', { ts: at(9) }),
      reply('m1', toolUse('t1', 'Bash'), {}, { ts: at(9, 1) }),
      toolResult('t1', 'fail', true, { ts: at(9, 2) }),
      prompt('b', { ts: at(14) }),
    ]))
    fx.write(`-Users-me-code-web/s2.jsonl`, jsonl([prompt('c', { sessionId: 's2', cwd: '/Users/me/code/web', ts: at(14, 30) })]))
    await indexer.scan()

    const cal = q.heatmap(db, 'calendar', 'messages', '2026-10-01', '2026-10-31')
    expect(cal.cells).toEqual([{ key: '2026-10-05', value: 4 }])
    expect(q.heatmap(db, 'calendar', 'sessions', '2026-10-01', '2026-10-31').total).toBe(2)
    expect(q.heatmap(db, 'calendar', 'errors', '2026-10-01', '2026-10-31').total).toBe(1)

    const wh = q.heatmap(db, 'weekhour', 'messages', '2026-10-01', '2026-10-31')
    expect(Object.fromEntries(wh.cells.map((c) => [c.key, c.value]))).toEqual({ '0:9': 2, '0:14': 2 })

    const proj = q.heatmap(db, 'project', 'messages', '2026-10-01', '2026-10-31')
    expect(proj.projects.map((p) => [p.name, p.total])).toEqual([['app', 3], ['web', 1]])
  })

  it('reports hidden cost only for counter runs the session owns', async () => {
    const { fx, db, indexer } = setup()
    const start = Date.parse('2026-10-01T09:00:00Z')
    fx.write(`${SLUG}/s1.jsonl`, jsonl([
      prompt('go'),
      reply('m1', text('ok'), { input: 0, output: 1_000_000, read: 0 }), // $20 on Opus 5.5
      costState('s1', start, 25, { added: 12, removed: 3 }),
    ]))
    fx.write(`${SLUG}/fork.jsonl`, jsonl([costState('fork', start, 25)]))
    await indexer.scan()
    const [row] = q.sessionRows(db, ['s1'])
    expect(row?.costEstimate).toBeCloseTo(20, 6)
    expect(row?.counter).toEqual({ cost: 25, since: start, transcriptCost: expect.closeTo(20, 6) })
    expect(row?.costHidden).toBeCloseTo(5, 6)
    // Changed lines come from the transcript's edits, not from the counter's per-run totals.
    expect(row?.linesAdded).toBe(0)
    // The fork has a copied counter but no calls of its own, so it is not a listed session.
    expect(q.sessions(db).rows.map((r) => r.id)).toEqual(['s1'])
  })

  it('finds sessions by prompt text', async () => {
    const { fx, db, indexer } = setup()
    fx.write(`${SLUG}/s1.jsonl`, jsonl([prompt('ödeme webhook testini düzelt')]))
    fx.write(`${SLUG}/s2.jsonl`, jsonl([prompt('README güncelle', { sessionId: 's2' })]))
    await indexer.scan()
    expect(q.sessions(db, { q: 'webhook' }).rows.map((r) => r.id)).toEqual(['s1'])
    expect(q.sessions(db, { q: '100%' }).rows).toEqual([])
  })
})

describe('buildTurns', () => {
  it('groups records into turns and attaches tool results', () => {
    const turns = buildTurns([
      prompt('fix the test'),
      reply('m1', text('Looking'), { output: 10 }),
      reply('m1', toolUse('t1', 'Bash', { command: 'npm test\n--watch' }), { output: 40 }),
      toolResult('t1', 'FAIL', true),
      { type: 'system', subtype: 'compact_boundary', timestamp: '2026-10-01T10:01:00Z', compactMetadata: { trigger: 'auto', preTokens: 150000 } },
      prompt('thanks'),
    ], new Pricing())
    expect(turns).toHaveLength(2)
    const [first] = turns
    expect(first?.prompt).toMatchObject({ text: 'fix the test', kind: 'prompt', images: 0 })
    expect(first?.items.map((i) => i.type)).toEqual(['text', 'tool', 'compact'])
    const tool = first?.items[1]
    expect(tool).toMatchObject({ type: 'tool', summary: 'npm test', result: { isError: true, text: 'FAIL' } })
    expect(first?.errors).toBe(1)
    expect(first?.outputTokens).toBe(40)
  })
})

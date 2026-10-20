import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { readLinesFrom } from '../server/jsonl.ts'
import { Pricing, normalizeModel } from '../server/pricing.ts'
import { projectOf } from '../server/project.ts'
import { possessive, withPossessive } from '../shared/tr.ts'

const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, webSearch: 0, fast: false }

describe('pricing', () => {
  const p = new Pricing()

  it('normalizes provider prefixes, dates and context suffixes', () => {
    expect(normalizeModel('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5')
    expect(normalizeModel('us.anthropic.claude-opus-4-8[1m]')).toBe('claude-opus-4-8')
    expect(normalizeModel('claude-opus-4-5@20251101')).toBe('claude-opus-4-5')
  })

  it('prices every token type, with 1-hour cache writes at 2x input', () => {
    // Opus 5.5: $4 in, $20 out, $0.20 cache read, $8 1h write.
    const cost = p.cost('claude-opus-5-5', { ...zero, input: 1e6, output: 1e6, cacheRead: 1e6, cacheWrite1h: 1e6 })
    expect(cost).toBeCloseTo(4 + 20 + 0.2 + 8, 6)
    expect(p.cost('claude-opus-5-5', { ...zero, cacheWrite5m: 1e6 })).toBeCloseTo(5, 6)
  })

  it('applies fast mode only where it is documented', () => {
    expect(p.cost('claude-opus-5-5', { ...zero, output: 1e6, fast: true })).toBeCloseTo(40, 6)
    expect(p.cost('claude-opus-4-7', { ...zero, output: 1e6, fast: true })).toBeCloseTo(25, 6)
  })

  it('switches Haiku 5.5 to long-prompt rates above 100K prompt tokens, per request', () => {
    expect(p.cost('claude-haiku-5-5', { ...zero, input: 100_000, output: 1e6 })).toBeCloseTo(0.01 + 0.5, 6)
    expect(p.cost('claude-haiku-5-5', { ...zero, input: 100_001, output: 1e6 })).toBeCloseTo((100_001 * 0.5) / 1e6 + 2.5, 6)
  })

  it('returns null for unknown models and counts web searches', () => {
    expect(p.cost('gpt-9', zero)).toBeNull()
    expect(p.cost('claude-sonnet-5-5', { ...zero, webSearch: 3 })).toBeCloseTo(0.03, 6)
  })

  it('changes its version when prices change', () => {
    expect(new Pricing({ 'claude-x': { input: 1, output: 2, cacheRead: 0.1 } }).version).not.toBe(p.version)
  })
})

describe('projectOf', () => {
  it('folds worktrees into their repository', () => {
    expect(projectOf('/Users/me/code/app/.claude/worktrees/fix-123', null)).toEqual({ key: '/Users/me/code/app', name: 'app' })
  })
  it('groups desktop scratch folders together', () => {
    expect(projectOf('/Users/me/Library/Application Support/Claude/scratch-workspaces/a/b/c', null).key).toBe('scratch')
  })
  it('falls back to the folder slug', () => {
    expect(projectOf(null, '-Users-me-code-app')).toEqual({ key: 'slug:-Users-me-code-app', name: 'app' })
  })
})

describe('Turkish possessive suffix', () => {
  it.each([
    [1, "'i"], [2, "'si"], [3, "'ü"], [6, "'sı"], [9, "'u"], [10, "'u"], [20, "'si"], [30, "'u"],
    [40, "'ı"], [41, "'i"], [56, "'sı"], [60, "'ı"], [70, "'i"], [90, "'ı"], [100, "'ü"], [1000, "'i"], [0, "'ı"],
  ])('%i -> %s', (n, suffix) => expect(possessive(n)).toBe(suffix))

  it('formats with a prefix', () => expect(withPossessive(40.4, '%')).toBe("%40'ı"))
})

describe('readLinesFrom', () => {
  const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wiener-jsonl-')), 'f.jsonl')

  it('leaves an unfinished last line for the next read', async () => {
    const f = tmp()
    fs.writeFileSync(f, '{"a":1}\n{"b":')
    const lines: string[] = []
    const end = await readLinesFrom(f, 0, (l) => lines.push(l))
    expect(lines).toEqual(['{"a":1}'])
    fs.appendFileSync(f, '2}\n')
    const end2 = await readLinesFrom(f, end, (l) => lines.push(l))
    expect(lines).toEqual(['{"a":1}', '{"b":2}'])
    expect(end2).toBe(fs.statSync(f).size)
  })

  it('consumes a complete last line without a newline', async () => {
    const f = tmp()
    fs.writeFileSync(f, '{"a":1}\n{"b":2}')
    const lines: string[] = []
    expect(await readLinesFrom(f, 0, (l) => lines.push(l))).toBe(fs.statSync(f).size)
    expect(lines).toHaveLength(2)
  })

  it('handles CRLF and multi-byte characters split across chunks', async () => {
    const f = tmp()
    fs.writeFileSync(f, '{"t":"çğışöü"}\r\n{"t":"ğ"}\r\n')
    const lines: string[] = []
    await readLinesFrom(f, 0, (l) => lines.push(l), undefined, 3)
    expect(lines.map((l) => JSON.parse(l).t)).toEqual(['çğışöü', 'ğ'])
  })
})

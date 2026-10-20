// İpuçları: command signatures, error causes, and each tip's trigger.
import { describe, expect, it } from 'vitest'
import { classifyError, commandSignature } from '../server/commands.ts'
import { openDb } from '../server/db.ts'
import { Indexer } from '../server/indexer.ts'
import { Pricing } from '../server/pricing.ts'
import { type TipsEnv, normalizePrompt, tipsReport } from '../server/tips.ts'
import type { Tip } from '../shared/types.ts'
import { jsonl, prompt, reply, tempProjects, text, toolResult, toolUse } from './fixtures.ts'

/** Noon, local time, `n` days before today, plus `s` seconds. */
const at = (n: number, s = 0) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(12, 0, s, 0)
  return d.toISOString()
}

const NO_ENV: TipsEnv = { instructions: [], mcp: [] }

async function setup(records: Record<string, unknown[]>) {
  const fx = tempProjects()
  for (const [file, rows] of Object.entries(records)) fx.write(file, jsonl(rows))
  const db = openDb(':memory:')
  const pricing = new Pricing()
  await new Indexer(db, pricing, { projectsDir: fx.root, desktopDir: null }).scan()
  return { db, pricing }
}

const kinds = (r: ReturnType<typeof tipsReport>) => r.tips.map((t) => t.kind)

describe('command signatures', () => {
  it('finds the command that does the work', () => {
    expect(commandSignature('cd /Users/me/app && git push origin main')).toBe('git push')
    expect(commandSignature('FOO=1 BAR="a b" npm run test -- --watch | tail -5')).toBe('npm run test')
    expect(commandSignature('S=/tmp/x; cat $S/log.txt')).toBe('cat')
    expect(commandSignature('./node_modules/.bin/vitest run')).toBe('vitest')
    expect(commandSignature('python3 -m pytest -q')).toBe('python3 -m pytest')
    expect(commandSignature('CID=$(gh api repos/a/b/issues --jq .)')).toBe('gh api')
    expect(commandSignature('cd /x')).toBeNull()
  })
})

describe('error causes', () => {
  it('separates setup mistakes from ordinary failures', () => {
    expect(classifyError('Exit code 127\n(eval):1: command not found: timeout')).toMatchObject({ kind: 'missing-tool', key: 'timeout' })
    expect(classifyError('Exit code 1\ndeno not found')).toMatchObject({ kind: 'missing-tool', key: 'deno' })
    expect(classifyError("Exit code 1\n(eval):1: no matches found: --include=*.ts")).toEqual({ kind: 'shell-syntax', key: 'glob', sample: '--include=*.ts' })
    expect(classifyError('fatal: not a git repository (or any of the parent directories): .git')).toMatchObject({ kind: 'not-git' })
    expect(classifyError('Exit code 1\nonulmaz: bir git deposu (veya üst dizinlerinden birisi) değil: .git')).toMatchObject({ kind: 'not-git' })
    expect(classifyError('Exit code 1\nFAIL test/a.test.ts > adds numbers')).toBeNull()
  })

  it('matches prompts typed the same way', () => {
    expect(normalizePrompt('  Repoyu İNCELE, mock var mı?')).toBe(normalizePrompt('repoyu incele mock var mı'))
  })
})

describe('tips', () => {
  it('flags context bloat with an upper-bound saving, ahead of tips without money', async () => {
    const big = Array.from({ length: 20 }, (_, i) => reply(`m${i}`, text('x'), { input: 0, read: 300_000, output: 100 }, { ts: at(2, i) }))
    const { db, pricing } = await setup({
      '-a/s1.jsonl': [prompt('go', { ts: at(2) }), ...big, ...Array.from({ length: 5 }, (_, i) => prompt('[Request interrupted by user]', { ts: at(2, 40 + i) }))],
    })
    const r = tipsReport(db, pricing, '30d', NO_ENV)
    const context = r.tips.find((t) => t.kind === 'context')
    expect(context).toMatchObject({ savingKind: 'upTo', examples: [expect.objectContaining({ sessionId: 's1' })] })
    // 20 calls × 150k tokens over the lean mark × $0.2 per million.
    expect(context?.saving).toBeCloseTo(0.6, 6)
    expect(kinds(r)).toEqual(['context', 'interrupts'])
  })

  it('stays quiet when nothing stands out', async () => {
    const { db, pricing } = await setup({ '-a/s1.jsonl': [prompt('merhaba', { ts: at(1) }), reply('m1', text('selam'), {}, { ts: at(1) })] })
    expect(tipsReport(db, pricing, '30d', NO_ENV).tips).toEqual([])
  })

  it('finds prompts retyped across sessions, ignoring short replies', async () => {
    const ask = 'repoyu incele, mock ve sahte veri var mı kontrol et'
    const { db, pricing } = await setup({
      '-a/s1.jsonl': [prompt(ask, { ts: at(3) }), prompt('devam et', { ts: at(3, 1) }), prompt('devam et', { ts: at(3, 2) })],
      '-a/s2.jsonl': [prompt(ask, { sessionId: 's2', ts: at(2) }), prompt('Repoyu incele; mock ve sahte veri var mı kontrol et!', { sessionId: 's2', ts: at(2, 1) })],
      '-a/s3.jsonl': [prompt('devam et', { sessionId: 's3', ts: at(1) })],
    })
    const tip = tipsReport(db, pricing, '30d', NO_ENV).tips.find((t) => t.kind === 'repeated-prompts')
    expect(tip?.examples).toEqual([expect.objectContaining({ detail: '3 kez · 2 oturum' })])
    expect(tip?.snippet?.label).toBe('~/.claude/commands/repoyu-incele-mock.md')
  })

  it('groups refused calls by command and setup failures by cause', async () => {
    const ts = at(1)
    const records: unknown[] = [prompt('başla', { ts })]
    for (let i = 0; i < 5; i++) {
      records.push(reply(`d${i}`, toolUse(`t${i}`, 'Bash', { command: `cd /repo && git push origin b${i}` }), {}, { ts }))
      records.push(toolResult(`t${i}`, 'no', true, { ts, extra: { toolDenialKind: 'user-rejected' } }))
    }
    for (let i = 0; i < 2; i++) {
      records.push(reply(`e${i}`, toolUse(`x${i}`, 'Bash', { command: 'timeout 5 npm test' }), {}, { ts }))
      records.push(toolResult(`x${i}`, 'Exit code 127\n(eval):1: command not found: timeout', true, { ts }))
    }
    records.push(reply('f1', toolUse('y1', 'Bash', { command: 'npm test' }), {}, { ts }), toolResult('y1', 'Exit code 1\nFAIL a.test.ts', true, { ts }))
    const { db, pricing } = await setup({ '-a/s1.jsonl': records })
    const r = tipsReport(db, pricing, '30d', NO_ENV)
    expect(r.tips.find((t) => t.kind === 'denials')?.examples).toEqual([
      expect.objectContaining({ label: 'git push', detail: '5 kez · sen reddettin' }),
    ])
    const setupTip = r.tips.find((t) => t.kind === 'setup-errors')
    expect(setupTip?.finding).toContain('2 komut')
    expect(setupTip?.snippet?.code).toContain('`timeout`')
  })

  it('prices a long CLAUDE.md by the requests that carried it, and lists unused MCP servers', async () => {
    const calls = Array.from({ length: 50 }, (_, i) => reply(`m${i}`, text('x'), { input: 0, read: 1000, output: 10 }, { cwd: '/Users/me/app', ts: at(1, i) }))
    const { db, pricing } = await setup({ '-Users-me-app/s1.jsonl': [prompt('go', { cwd: '/Users/me/app', ts: at(1) }), ...calls] })
    const env: TipsEnv = {
      instructions: [{ id: 'i1', path: '/Users/me/app/CLAUDE.md', scope: 'app', scopeKind: 'project', file: '~/app/CLAUDE.md', mtime: 0, size: 400_000 }],
      mcp: [
        { name: 'unused', scope: 'Kullanıcı', scopeKind: 'user', transport: 'stdio', target: 'x', calls: 0, errors: 0, lastUsedAt: null, topTools: [] },
        { name: 'shared', scope: 'Proje: app', scopeKind: 'project', transport: 'stdio', target: 'y', calls: 0, errors: 0, lastUsedAt: null, topTools: [] },
        { name: 'ccd_session', scope: 'Desktop uygulaması', scopeKind: 'desktop', transport: null, target: null, calls: 0, errors: 0, lastUsedAt: null, topTools: [] },
      ],
    }
    const r = tipsReport(db, pricing, '30d', env)
    // 100k tokens read by 50 requests at $0.2 per million.
    expect(r.tips.find((t) => t.kind === 'claude-md')?.finding).toContain('$1,00')
    const mcp = r.tips.find((t) => t.kind === 'unused-mcp')
    expect(mcp?.examples.map((e) => e.label)).toEqual(['unused', 'shared'])
    expect(mcp?.snippet?.code).toBe('claude mcp remove unused -s user\n')
  })

  it('counts what fast mode added', async () => {
    const { db, pricing } = await setup({
      '-a/s1.jsonl': [prompt('go', { ts: at(1) }), reply('m1', text('x'), { input: 0, read: 0, output: 100_000, speed: 'fast' }, { ts: at(1) })],
    })
    // $2 at the normal rate, $4 in fast mode: $2 extra.
    expect(tipsReport(db, pricing, '30d', NO_ENV).tips.find((t) => t.kind === 'fast-mode')?.saving).toBeCloseTo(2, 6)
  })
})

describe('tips in English', () => {
  const TURKISH = /[çğıöşüÇĞİÖŞÜ]/
  /** Everything a tip shows. The fixtures below use English prompts and titles, so nothing is excluded. */
  const shown = (t: Tip) => [
    t.title, t.finding, t.why, t.action,
    ...t.examples.flatMap((e) => [e.label, e.detail]),
    ...(t.snippet ? [t.snippet.label, t.snippet.code] : []),
  ]

  async function englishTips(): Promise<Tip[]> {
    const tips: Tip[] = []
    const run = async (records: Record<string, unknown[]>, env: TipsEnv = NO_ENV) => {
      const { db, pricing } = await setup(records)
      tips.push(...tipsReport(db, pricing, '30d', env, 'en').tips)
    }
    // Context bloat and interrupts.
    const big = Array.from({ length: 20 }, (_, i) => reply(`m${i}`, text('x'), { input: 0, read: 300_000, output: 100 }, { ts: at(2, i) }))
    await run({ '-a/s1.jsonl': [prompt('go', { ts: at(2) }), ...big, ...Array.from({ length: 5 }, (_, i) => prompt('[Request interrupted by user]', { ts: at(2, 40 + i) }))] })
    // Cache rewritten after breaks of six minutes.
    await run({
      '-a/s1.jsonl': [prompt('go', { ts: at(3) }), ...Array.from({ length: 4 }, (_, i) => reply(`w${i}`, text('x'), { write5m: 150_000 }, { ts: at(3, 1 + i * 360) }))],
    })
    // A light session on a large model, a large model for subagents, and fast mode.
    await run({
      '-a/s1.jsonl': [
        prompt('what does this error mean', { ts: at(1) }),
        reply('l1', text('x'), { input: 0, read: 0, output: 200_000 }, { ts: at(1) }),
        reply('f1', text('x'), { input: 0, read: 0, output: 100_000, speed: 'fast' }, { ts: at(1) }),
        reply('g1', toolUse('a1', 'Agent', { subagent_type: 'Explore', prompt: 'find it' }), {}, { ts: at(1) }),
        reply('g2', text('x'), { input: 0, read: 0, output: 600_000 }, { ts: at(1), extra: { isSidechain: true } }),
      ],
    })
    // Prompts retyped across sessions.
    const ask = 'review the repo and check for mocks or fake data'
    await run({
      '-a/s1.jsonl': [prompt(ask, { ts: at(3) })],
      '-a/s2.jsonl': [prompt(ask, { sessionId: 's2', ts: at(2) }), prompt(`${ask}!`, { sessionId: 's2', ts: at(2, 1) })],
    })
    // Denied calls and every kind of setup error.
    const ts = at(1)
    const records: unknown[] = [prompt('start', { ts })]
    for (let i = 0; i < 5; i++) {
      records.push(reply(`d${i}`, toolUse(`t${i}`, 'Bash', { command: `git push origin b${i}` }), {}, { ts }))
      records.push(toolResult(`t${i}`, 'no', true, { ts, extra: { toolDenialKind: 'user-rejected' } }))
    }
    const errors = [
      ...Array(2).fill('Exit code 127\n(eval):1: command not found: timeout'),
      ...Array(3).fill('Exit code 1\n(eval):1: no matches found: --include=*.ts'),
      ...Array(3).fill('fatal: not a git repository (or any of the parent directories): .git'),
      ...Array(3).fill('Command timed out after 2m 0s'),
    ] as string[]
    errors.forEach((e, i) => {
      records.push(reply(`e${i}`, toolUse(`x${i}`, 'Bash', { command: 'npm test' }), {}, { ts }), toolResult(`x${i}`, e, true, { ts }))
    })
    await run({ '-a/s1.jsonl': records })
    // A long CLAUDE.md and unused MCP servers.
    const calls = Array.from({ length: 50 }, (_, i) => reply(`m${i}`, text('x'), { input: 0, read: 1000, output: 10 }, { cwd: '/Users/me/app', ts: at(1, i) }))
    await run({ '-Users-me-app/s1.jsonl': [prompt('go', { cwd: '/Users/me/app', ts: at(1) }), ...calls] }, {
      instructions: [{ id: 'i1', path: '/Users/me/app/CLAUDE.md', scope: 'app', scopeKind: 'project', file: '~/app/CLAUDE.md', mtime: 0, size: 400_000 }],
      mcp: [
        { name: 'unused', scope: 'User', scopeKind: 'user', transport: 'stdio', target: 'x', calls: 0, errors: 0, lastUsedAt: null, topTools: [] },
        { name: 'shared', scope: 'Project: app', scopeKind: 'project', transport: 'stdio', target: 'y', calls: 0, errors: 0, lastUsedAt: null, topTools: [] },
      ],
    })
    return tips
  }

  it('writes every tip in English', async () => {
    const tips = await englishTips()
    expect(new Set(tips.map((t) => t.kind))).toEqual(new Set([
      'context', 'cache-rewrite', 'claude-md', 'light-sessions', 'subagent-model', 'fast-mode',
      'setup-errors', 'interrupts', 'repeated-prompts', 'denials', 'unused-mcp',
    ]))
    for (const t of tips) for (const s of shown(t)) expect(s, `${t.kind}: ${s}`).not.toMatch(TURKISH)

    const find = (kind: Tip['kind']) => tips.find((t) => t.kind === kind)
    expect(find('claude-md')?.finding).toBe(
      '/Users/me/app/CLAUDE.md is about 100K tokens. In the last 30 days, it was read again with each of 50 requests, at a cost of about $1.00.',
    )
    expect(find('fast-mode')?.finding).toBe('In the last 30 days, fast mode added $2.00 to the cost of 1 request.')
    expect(find('context')?.finding).toContain('came from 20 calls with more than 200K tokens of context')
    expect(find('denials')?.finding).toBe('In the last 30 days, you rejected 5 tool calls before they ran.')
    expect(find('denials')?.examples).toEqual([expect.objectContaining({ label: 'git push', detail: '5 times · rejected by you' })])
    expect(find('cache-rewrite')?.finding).toBe(
      'In the last 30 days, the whole context was written to the cache again 3 times after a break of more than 5 minutes. Those writes cost $2.25.',
    )
    expect(find('repeated-prompts')?.examples).toEqual([expect.objectContaining({ detail: '3 times · 2 sessions' })])
    expect(find('repeated-prompts')?.snippet?.label).toBe('~/.claude/commands/review-the-repo.md')
    expect(find('subagent-model')?.snippet?.label).toBe('.claude/agents/researcher.md')
    expect(find('setup-errors')?.snippet?.code).toContain("- `timeout` is not installed on this machine; don't write commands that depend on it.\n")
    expect(find('unused-mcp')?.examples.map((e) => e.detail)).toEqual(['User · never used', 'Project: app · never used'])
  })
})

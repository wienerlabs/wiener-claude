// Phase 4: tools and features, project trends, the year in review.
import { describe, expect, it } from 'vitest'
import { openDb } from '../server/db.ts'
import { Indexer } from '../server/indexer.ts'
import { languageOf, languageShares, mainLanguage } from '../server/languages.ts'
import { Pricing } from '../server/pricing.ts'
import { projectDetail, projectList } from '../server/projects.ts'
import { categoryOf, toolsReport } from '../server/tools.ts'
import { longestStreak, yearReport } from '../server/year.ts'
import { jsonl, prompt, reply, tempProjects, text, toolResult, toolUse } from './fixtures.ts'

/** Noon, local time, `n` days before today, as an ISO string. */
const daysAgo = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(12, 0, 0, 0)
  return d.toISOString()
}

async function setup(records: Record<string, unknown[]>) {
  const fx = tempProjects()
  for (const [file, rows] of Object.entries(records)) fx.write(file, jsonl(rows))
  const db = openDb(':memory:')
  await new Indexer(db, new Pricing(), { projectsDir: fx.root, desktopDir: null }).scan()
  return db
}

const edit = (id: string, filePath: string, lines: number, ts: string) =>
  toolResult(id, 'ok', false, {
    ts,
    extra: { toolUseResult: { filePath, structuredPatch: [{ lines: Array.from({ length: lines }, () => '+x') }] } },
  })

describe('tools report', () => {
  it('counts calls by tool and kind, tells failures from refusals, and groups MCP tools under their server', async () => {
    const ts = daysAgo(1)
    const db = await setup({
      '-a/s1.jsonl': [
        prompt('başla', { ts }),
        reply('m1', toolUse('t1', 'Bash', { command: 'npm test' }), {}, { ts }),
        toolResult('t1', 'failed', true, { ts }),
        reply('m2', toolUse('t2', 'Bash', { command: 'rm -rf x' }), {}, { ts }),
        toolResult('t2', 'no', true, { ts, extra: { toolDenialKind: 'user-rejected' } }),
        reply('m3', toolUse('t3', 'mcp__github__create_pr'), {}, { ts }),
        reply('m4', toolUse('t4', 'mcp__github__get_issue'), {}, { ts }),
        reply('m5', toolUse('t5', 'Skill', { skill: 'frontend-design:frontend-design' }), {}, { ts }),
        reply('m6', toolUse('t6', 'Agent', { description: 'x', prompt: 'y', subagent_type: 'Explore' }), {}, { ts }),
        prompt('<command-name>/compact</command-name><command-args>notları tut</command-args>', { ts }),
      ],
      '-a/s2.jsonl': [prompt('ikinci', { sessionId: 's2', ts }), reply('m7', text('tamam'), {}, { sessionId: 's2', ts })],
    })
    const r = toolsReport(db, '30d')
    expect(r.sessions).toBe(2)
    expect(r.totals).toMatchObject({ calls: 6, errors: 1, denied: 1 })
    expect(r.tools.find((t) => t.name === 'Bash')).toMatchObject({ category: 'shell', calls: 2, errors: 1, denied: 1, sessions: 1 })
    expect(r.tools.some((t) => t.name.startsWith('mcp__'))).toBe(false)
    expect(r.categories.find((c) => c.key === 'mcp')?.calls).toBe(2)
    expect(r.mcp).toEqual([expect.objectContaining({ name: 'github', calls: 2, tools: expect.arrayContaining([{ name: 'create_pr', calls: 1 }]) })])
    expect(r.skills.map((s) => s.name)).toEqual(['frontend-design:frontend-design'])
    expect(r.agents.map((s) => s.name)).toEqual(['Explore'])
    expect(r.commands).toEqual([expect.objectContaining({ name: '/compact', calls: 1 })])
    const feature = (k: string) => r.features.find((f) => f.key === k)
    expect(feature('mcp')).toMatchObject({ sessions: 1, uses: 2 })
    expect(feature('commands')).toMatchObject({ sessions: 1, uses: 1 })
    expect(feature('plan')).toMatchObject({ sessions: 0, uses: 0 })
    expect(r.versions[0]).toMatchObject({ version: '2.1.0', sessions: 2 })
  })

  it('reports what subagents cost as a share of all spend', async () => {
    const ts = daysAgo(1)
    const db = await setup({
      '-a/s1.jsonl': [prompt('go', { ts }), reply('m1', text('x'), { input: 0, read: 0, output: 1_000_000 }, { ts })],
      '-a/s1/subagents/agent-1.jsonl': [reply('m2', text('y'), { input: 0, read: 0, output: 1_000_000 }, { ts, extra: { isSidechain: true } })],
    })
    const r = toolsReport(db, '30d')
    expect(r.subagents.cost).toBeCloseTo(20, 6)
    expect(r.subagents.share).toBeCloseTo(0.5, 6)
  })

  it('sorts tools into kinds', () => {
    expect(categoryOf('Read')).toBe('files')
    expect(categoryOf('mcp__x__y')).toBe('mcp')
    expect(categoryOf('AskUserQuestion')).toBe('planning')
    expect(categoryOf('SomethingNew')).toBe('other')
  })
})

describe('languages', () => {
  it('names languages by extension and keeps docs out of the main language', () => {
    expect(languageOf('/a/b/App.tsx')).toBe('TypeScript')
    expect(languageOf('/a/Dockerfile')).toBe('Dockerfile')
    expect(languageOf('/a/.gitignore')).toBe('Other')
    const shares = languageShares([
      { path: '/r/README.md', lines: 900, edits: 3 },
      { path: '/r/src/main.rs', lines: 120, edits: 4 },
      { path: '/r/src/lib.rs', lines: 30, edits: 1 },
      { path: '/r/NOTICE', lines: 5000, edits: 1 },
    ])
    expect(shares.map((s) => s.name)).toEqual(['Markdown', 'Rust', 'Other'])
    expect(shares[1]).toMatchObject({ lines: 150, edits: 5, files: 2 })
    expect(mainLanguage(shares)).toBe('Rust')
    expect(mainLanguage(languageShares([{ path: '/r/a.json', lines: 3, edits: 1 }]))).toBeNull()
  })
})

describe('project trends', () => {
  it('splits a project by branch and language, and charts its cost', async () => {
    const ts = daysAgo(2)
    const cwd = '/Users/me/app'
    const db = await setup({
      '-Users-me-app/s1.jsonl': [
        prompt('a', { cwd, ts }),
        reply('m1', toolUse('e1', 'Edit'), { input: 0, read: 0, output: 1_000_000 }, { cwd, ts }),
        edit('e1', '/Users/me/app/src/a.ts', 40, ts),
        prompt('a2', { cwd, ts }),
      ],
      '-Users-me-app/s2.jsonl': [
        prompt('b', { cwd, ts, sessionId: 's2', extra: { gitBranch: 'feature/x' } }),
        reply('m2', toolUse('e2', 'Write'), {}, { cwd, ts, sessionId: 's2' }),
        edit('e2', '/Users/me/app/README.md', 10, ts),
      ],
    })
    const p = projectDetail(db, '/Users/me/app', '30d')
    expect(p?.branches.map((b) => [b.name, b.sessions, b.messages])).toEqual([['main', 1, 3], ['feature/x', 1, 2]])
    expect(p?.branches[0]?.cost).toBeCloseTo(20, 6)
    expect(p?.languages.map((l) => [l.name, l.lines])).toEqual([['TypeScript', 40], ['Markdown', 10]])
    expect(p?.language).toBe('TypeScript')
    expect(p?.series.bucket).toBe('day')
    expect(p?.series.points.reduce((s, x) => s + x.cost, 0)).toBeGreaterThanOrEqual(20)
    expect(projectList(db, '30d')[0]?.language).toBe('TypeScript')
  })

  it('names the desktop worktree branch when git reports a detached HEAD', async () => {
    const ts = daysAgo(1)
    const db = await setup({ '-Users-me-app/s1.jsonl': [prompt('a', { cwd: '/Users/me/app', ts, extra: { gitBranch: 'HEAD' } })] })
    db.prepare("INSERT INTO desktop_sessions (cli_session_id, branch) VALUES ('s1', 'claude/fix-login')").run()
    expect(projectDetail(db, '/Users/me/app', '30d')?.branches.map((b) => b.name)).toEqual(['claude/fix-login'])
  })
})

describe('year in review', () => {
  it('finds the longest run of consecutive days', () => {
    expect(longestStreak([])).toBeNull()
    expect(longestStreak(['2025-03-05', '2025-03-01', '2025-03-02', '2025-03-03', '2025-03-07'])).toEqual({ days: 3, from: '2025-03-01', to: '2025-03-03' })
    expect(longestStreak(['2025-12-31', '2025-12-30'])).toEqual({ days: 2, from: '2025-12-30', to: '2025-12-31' })
  })

  it('sums a past year and picks its highlights', async () => {
    const at = (day: string) => `${day}T12:00:00.000Z`
    const db = await setup({
      '-Users-me-app/s1.jsonl': [
        prompt('a', { cwd: '/Users/me/app', ts: at('2025-03-01') }),
        reply('m1', toolUse('t1', 'Bash'), { input: 0, read: 0, output: 1_000_000 }, { cwd: '/Users/me/app', ts: at('2025-03-01') }),
        reply('m2', text('x'), {}, { cwd: '/Users/me/app', ts: at('2025-03-01') }),
        prompt('b', { cwd: '/Users/me/app', ts: at('2025-03-02') }),
        prompt('c', { cwd: '/Users/me/app', ts: at('2025-03-03') }),
        prompt('<command-name>/model</command-name>', { cwd: '/Users/me/app', ts: at('2025-05-10') }),
        prompt('next year', { cwd: '/Users/me/app', ts: at('2026-01-05') }),
      ],
    })
    const y = yearReport(db, 2025)
    expect(y).toMatchObject({ year: 2025, from: '2025-01-01', to: '2025-12-31', partial: false, firstDay: '2025-03-01', activeDays: 4 })
    expect(y.years).toEqual(expect.arrayContaining([2026, 2025]))
    expect(y.totals).toMatchObject({ sessions: 1, messages: 6, prompts: 4, toolCalls: 1, outputTokens: 1_000_100 })
    expect(y.totals.cost).toBeGreaterThan(20)
    expect(y.longestStreak).toEqual({ days: 3, from: '2025-03-01', to: '2025-03-03' })
    expect(y.busiestDay).toEqual({ day: '2025-03-01', messages: 3 })
    expect(y.months[2]).toBe(5)
    expect(y.months[4]).toBe(1)
    expect(y.projects).toEqual([expect.objectContaining({ name: 'app', messages: 6 })])
    expect(y.tools).toEqual([{ name: 'Bash', calls: 1 }])
    expect(y.command).toEqual({ name: '/model', uses: 1 })
    expect(y.model).toMatchObject({ share: 1 })
    expect(y.longestSession).toMatchObject({ id: 's1', messages: 6 })
  })
})

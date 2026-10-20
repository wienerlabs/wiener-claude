import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../server/api.ts'
import { budgetCrossing } from '../server/costs.ts'
import { openDb } from '../server/db.ts'
import { fileContent, frontMatter, mcpTarget, memoryFiles, plans, settingsView, taskGroups } from '../server/env.ts'
import { Indexer } from '../server/indexer.ts'
import { parseLine } from '../server/parse.ts'
import { Pricing } from '../server/pricing.ts'
import * as q from '../server/queries.ts'
import { readSettings, updateSettings } from '../server/settings.ts'
import { jsonl, prompt, reply, tempProjects, text, toolResult, toolUse } from './fixtures.ts'

const main = { fileSessionId: 's1', isSubagent: false }
const SLUG = '-Users-me-code-app'

function setup() {
  const fx = tempProjects()
  const db = openDb(':memory:')
  const indexer = new Indexer(db, new Pricing(), { projectsDir: fx.root, desktopDir: null })
  return { fx, db, indexer }
}

describe('tasks and plans in transcripts', () => {
  it('reads task creation from the result and updates from the call', () => {
    const created = toolResult('t1', 'ok', false, { extra: { toolUseResult: { task: { id: '3', subject: 'Testleri yaz' } } } })
    const updated = reply('m1', toolUse('t2', 'TaskUpdate', { taskId: '3', status: 'completed' }))
    const facts = [created, updated].flatMap((r) => parseLine(r, main)).filter((f) => f.kind === 'task')
    expect(facts).toEqual([
      expect.objectContaining({ op: 'create', taskId: '3', subject: 'Testleri yaz' }),
      expect.objectContaining({ op: 'update', taskId: '3', status: 'completed', subject: null }),
    ])
  })

  it('records which skill ran and which subagent type was spawned', () => {
    const facts = [
      reply('m1', toolUse('t1', 'Skill', { skill: 'frontend-design:frontend-design' })),
      reply('m2', toolUse('t2', 'Agent', { description: 'x', prompt: 'y', subagent_type: 'Explore' })),
      reply('m3', toolUse('t3', 'Agent', { description: 'x', prompt: 'y' })),
    ].flatMap((r) => parseLine(r, main)).filter((f) => f.kind === 'tool_use')
    expect(facts.map((f) => f.kind === 'tool_use' && f.detail)).toEqual(['frontend-design:frontend-design', 'Explore', 'general-purpose'])
  })

  it('follows a task list through updates, replaces TodoWrite lists, and keeps plans with their outcome', async () => {
    const { fx, db, indexer } = setup()
    const create = (id: string, subject: string) => toolResult(`c${id}`, 'ok', false, { extra: { toolUseResult: { task: { id, subject } } } })
    fx.write(`${SLUG}/s1.jsonl`, jsonl([
      prompt('başla', { ts: '2026-10-01T10:00:00Z' }),
      create('1', 'Şemayı çıkar'),
      create('2', 'API yaz'),
      create('3', 'Gereksiz'),
      reply('m1', toolUse('u1', 'TaskUpdate', { taskId: '1', status: 'completed' })),
      reply('m2', toolUse('u2', 'TaskUpdate', { taskId: '2', status: 'in_progress' })),
      reply('m3', toolUse('u3', 'TaskUpdate', { taskId: '3', status: 'deleted' })),
      reply('m4', toolUse('p1', 'ExitPlanMode', { plan: '# Ödeme akışı\n\n1. Şema\n2. API' }), {}, { ts: '2026-10-01T10:05:00Z' }),
      toolResult('p1', 'approved'),
      reply('m5', toolUse('p2', 'ExitPlanMode', { plan: 'İkinci deneme' }), {}, { ts: '2026-10-01T10:09:00Z' }),
      toolResult('p2', 'The user doesn\'t want to proceed', true),
    ]))
    fx.write(`${SLUG}/s2.jsonl`, jsonl([
      prompt('eski usul', { sessionId: 's2' }),
      reply('m6', toolUse('w1', 'TodoWrite', { todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'pending' }] }), {}, { sessionId: 's2' }),
      reply('m7', toolUse('w2', 'TodoWrite', { todos: [{ content: 'b', status: 'in_progress' }] }), {}, { sessionId: 's2' }),
    ]))
    await indexer.scan()
    const groups = taskGroups(db)
    const s1 = groups.find((g) => g.sessionId === 's1')
    expect(s1?.tasks.map((t) => [t.id, t.subject, t.status])).toEqual([['1', 'Şemayı çıkar', 'completed'], ['2', 'API yaz', 'in_progress']])
    expect(groups.find((g) => g.sessionId === 's2')?.tasks.map((t) => [t.subject, t.status])).toEqual([['b', 'in_progress']])
    expect(plans(db).map((p) => [p.title, p.outcome])).toEqual([['İkinci deneme', 'rejected'], ['Ödeme akışı', 'approved']])
  })
})

describe('environment files', () => {
  let dir: string
  const saved = process.env.CLAUDE_CONFIG_DIR
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiener-env-'))
    process.env.CLAUDE_CONFIG_DIR = dir
  })
  afterEach(() => {
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = saved
  })

  it('parses front matter, including a nested metadata type', () => {
    expect(frontMatter('---\nname: dil-tercihi\ndescription: "Türkçe yanıt"\nmetadata:\n  type: user\n---\nBody')).toEqual({
      name: 'dil-tercihi', description: 'Türkçe yanıt', 'metadata.type': 'user',
    })
    expect(frontMatter('No front matter')).toEqual({})
  })

  it('lists memory files and serves content only by an id it handed out', () => {
    const mem = path.join(dir, 'projects', SLUG, 'memory')
    fs.mkdirSync(mem, { recursive: true })
    fs.writeFileSync(path.join(mem, 'dil.md'), '---\nname: dil\ndescription: Türkçe\nmetadata:\n  type: feedback\n---\nYanıtlar Türkçe olsun.')
    fs.writeFileSync(path.join(mem, 'MEMORY.md'), '- [dil](dil.md)')
    const db = openDb(':memory:')
    const files = memoryFiles(db)
    expect(files.map((f) => [f.name, f.type])).toEqual(expect.arrayContaining([['dil', 'feedback'], ['Dizin (MEMORY.md)', 'index']]))
    const id = files.find((f) => f.name === 'dil')?.id ?? ''
    expect(fileContent(db, id)?.text).toContain('Yanıtlar Türkçe olsun.')
    expect(fileContent(db, 'deadbeefdeadbeef')).toBeNull()
    expect(fileContent(db, '../../etc/passwd')).toBeNull()
  })
})

describe('secrets stay out of the environment report', () => {
  it('shows MCP programs, package names and hosts, never args, env or headers', () => {
    expect(mcpTarget({ command: '/usr/local/bin/npx', args: ['-y', '@upstash/context7-mcp@latest', '--api-key', 'sk-123'], env: { TOKEN: 'x' } }))
      .toEqual({ transport: 'stdio', target: 'npx @upstash/context7-mcp@latest' })
    expect(mcpTarget({ command: 'npx', args: ['--token=abc', 'https://evil/?key=1'] })).toEqual({ transport: 'stdio', target: 'npx' })
    expect(mcpTarget({ command: 'node', args: ['/secret/path/server.js', 'sk-live-1'] })).toEqual({ transport: 'stdio', target: 'node' })
    expect(mcpTarget({ type: 'http', url: 'https://mcp.example.com/v1?token=abc', headers: { Authorization: 'Bearer x' } }))
      .toEqual({ transport: 'http', target: 'mcp.example.com' })
  })

  it('shows settings values only where they cannot hold a secret', () => {
    const view = settingsView({
      permissions: { allow: ['Bash(npm test)'], defaultMode: 'acceptEdits' },
      hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: '/Users/me/bin/notify.sh --token abc123' }] }] },
      env: { ANTHROPIC_API_KEY: 'sk-ant-secret', DEBUG: '1' },
      language: 'Turkish',
      apiKeyHelper: '/bin/echo sk-ant-secret',
      cleanupPeriodDays: 30,
    }, '/Users/me/.claude/settings.json')
    const dump = JSON.stringify(view)
    expect(dump).not.toContain('sk-ant-secret')
    expect(dump).not.toContain('abc123')
    expect(view.hooks).toEqual([{ event: 'PostToolUse', matcher: 'Edit', command: 'notify.sh' }])
    expect(view.envKeys).toEqual(['ANTHROPIC_API_KEY', 'DEBUG'])
    expect(view.values).toEqual(expect.arrayContaining([
      { key: 'permissions.defaultMode', value: 'acceptEdits' }, { key: 'language', value: 'Turkish' }, { key: 'cleanupPeriodDays', value: '30' },
    ]))
    expect(view.otherKeys).toContain('apiKeyHelper')
  })
})

describe('budget', () => {
  const saved = process.env.WIENER_DATA_DIR
  beforeEach(() => {
    process.env.WIENER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wiener-data-'))
  })
  afterEach(() => {
    if (saved === undefined) delete process.env.WIENER_DATA_DIR
    else process.env.WIENER_DATA_DIR = saved
  })

  it('saves a valid budget and refuses anything else', () => {
    expect(readSettings()).toEqual({ monthlyBudget: null })
    expect(updateSettings({ monthlyBudget: 500 })).toEqual({ monthlyBudget: 500 })
    expect(readSettings()).toEqual({ monthlyBudget: 500 })
    expect(() => updateSettings({ monthlyBudget: -1 })).toThrow()
    expect(() => updateSettings({ theme: 'dark' })).toThrow()
    expect(updateSettings({ monthlyBudget: null })).toEqual({ monthlyBudget: null })
  })

  it('finds the day spending crosses the budget', () => {
    const daily = [{ day: '2026-10-01', cost: 100 }, { day: '2026-10-02', cost: 300 }, { day: '2026-10-03', cost: 50 }]
    expect(budgetCrossing(daily, 350, 450, 3, '2026-10-01', 31)).toBe('2026-10-02')
    // $150/day reaches $1.000 after 6.7 days: on the 7th.
    expect(budgetCrossing(daily, 1000, 450, 3, '2026-10-01', 31)).toBe('2026-10-07')
    expect(budgetCrossing(daily, 10_000, 450, 3, '2026-10-01', 31)).toBeNull()
  })

  it('warns in the weekly insights when the pace will exceed it', async () => {
    const { fx, db, indexer } = setup()
    const ts = new Date().toISOString()
    fx.write(`${SLUG}/s1.jsonl`, jsonl([prompt('go', { ts }), reply('m1', text('x'), { input: 0, read: 0, output: 5_000_000 }, { ts })])) // $100
    await indexer.scan()
    const [first] = q.insights(db, 50)
    expect(first).toMatchObject({ tone: 'warn', href: '/maliyet' })
    expect(first?.text).toContain('bütçeni aştın')
  })
})

describe('write protection', () => {
  const saved = process.env.WIENER_DATA_DIR
  beforeEach(() => {
    process.env.WIENER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wiener-data-'))
  })
  afterEach(() => {
    if (saved === undefined) delete process.env.WIENER_DATA_DIR
    else process.env.WIENER_DATA_DIR = saved
  })

  function app() {
    const db = openDb(':memory:')
    const pricing = new Pricing()
    return createApp({
      db, pricing, indexer: new Indexer(db, pricing, { projectsDir: '/nonexistent', desktopDir: null }),
      events: new EventEmitter(), staticDir: null, allowedHosts: new Set(['localhost', '127.0.0.1', '[::1]']),
    })
  }
  const put = (headers: Record<string, string>, body = '{"monthlyBudget":200}') =>
    app().request('http://localhost:4747/api/settings', { method: 'PUT', headers: { host: 'localhost:4747', ...headers }, body })

  it('accepts a JSON write from the panel', async () => {
    const res = await put({ 'content-type': 'application/json', origin: 'http://localhost:5747' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ monthlyBudget: 200 })
  })

  it('refuses form posts and writes from other sites', async () => {
    expect((await put({ 'content-type': 'text/plain' })).status).toBe(415)
    expect((await put({ 'content-type': 'application/json', origin: 'https://evil.example' })).status).toBe(403)
    expect((await put({ 'content-type': 'application/json' }, '{"monthlyBudget":"çok"}')).status).toBe(400)
    expect(readSettings()).toEqual({ monthlyBudget: null })
  })
})

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { listAccounts } from '../server/accounts.ts'
import { openDb } from '../server/db.ts'
import { Indexer } from '../server/indexer.ts'
import { parseHistoryLine } from '../server/parse.ts'
import { Pricing } from '../server/pricing.ts'
import * as q from '../server/queries.ts'
import { historyTurns } from '../server/replay.ts'
import { jsonl, prompt, reply, tempProjects, text } from './fixtures.ts'

const ACCOUNT = '11111111-1111-4111-8111-111111111111'
const ORG = '33333333-3333-4333-8333-333333333333'
const MARCH = Date.parse('2026-03-10T09:00:00Z')

const entry = (sessionId: string, display: string, minutes: number, project = '/Users/me/code/old') =>
  ({ display, pastedContents: {}, timestamp: MARCH + minutes * 60_000, project, sessionId })

function setup() {
  const fx = tempProjects()
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wiener-history-'))
  const historyFile = path.join(home, 'history.jsonl')
  const coworkDir = path.join(home, 'local-agent-mode-sessions')
  const db = openDb(':memory:')
  const indexer = new Indexer(db, new Pricing(), { projectsDir: fx.root, desktopDir: null, coworkDir, historyFile })
  const count = (sql: string, ...args: string[]) => (db.prepare(sql).get(...args) as { c: number }).c
  return { fx, db, indexer, historyFile, coworkDir, count }
}

describe('prompt history', () => {
  it('reads a history line as a session with one prompt, telling commands and shell input apart', () => {
    const kinds = ['fix the login bug', '/model', '!git status'].map((d) => parseHistoryLine(entry('a', d, 0)).find((f) => f.kind === 'prompt'))
    expect(kinds.map((f) => (f?.kind === 'prompt' ? f.promptKind : null))).toEqual(['prompt', 'command', 'bash'])
    expect(parseHistoryLine({ ...entry('a', '   ', 0) })).toEqual([])
    expect(parseHistoryLine({ display: 'x', timestamp: MARCH, project: '/p' })).toEqual([])
  })

  it('counts the prompts of a session whose transcript is gone, and nothing twice for one that still has it', async () => {
    const { fx, db, indexer, historyFile, count } = setup()
    fx.write('-Users-me-code-app/s1.jsonl', jsonl([prompt('hello', { sessionId: 's1' }), reply('m1', text('hi'), {}, { sessionId: 's1' })]))
    fs.writeFileSync(historyFile, jsonl([
      entry('old', 'fix the login bug', 0), entry('old', '/model', 1), entry('old', 'now add a test', 2),
      entry('s1', 'hello', 0, '/Users/me/code/app'),
    ]))
    await indexer.scan()
    expect(count("SELECT count(*) AS c FROM prompts WHERE session_id = 'old'")).toBe(3)
    expect(count("SELECT count(*) AS c FROM prompts WHERE session_id = 's1'")).toBe(1)
    const old = q.session(db, 'old')
    expect({ historyOnly: old?.historyOnly, prompts: old?.prompts, project: old?.projectName, title: old?.title }).toEqual({
      historyOnly: true, prompts: 3, project: 'old', title: 'fix the login bug',
    })
    expect(q.sessions(db, { source: 'cli' }).rows.map((r) => r.id).sort()).toEqual(['old', 's1'])
    expect(q.session(db, 's1')?.historyOnly).toBe(false)
    expect(historyTurns(db, 'old', 'tr').turns.map((t) => t.prompt?.text)).toEqual(['fix the login bug', '/model', 'now add a test'])
  })

  it('drops a session history prompts once its transcript shows up', async () => {
    const { fx, indexer, historyFile, count } = setup()
    fs.writeFileSync(historyFile, jsonl([entry('late', 'first', 0, '/Users/me/code/app'), entry('late', 'second', 1, '/Users/me/code/app')]))
    await indexer.scan()
    expect(count("SELECT count(*) AS c FROM prompts WHERE session_id = 'late'")).toBe(2)
    fx.write('-Users-me-code-app/late.jsonl', jsonl([
      prompt('first', { sessionId: 'late', ts: new Date(MARCH).toISOString() }),
      prompt('second', { sessionId: 'late', ts: new Date(MARCH + 60_000).toISOString() }),
    ]))
    await indexer.scan()
    expect(count("SELECT count(*) AS c FROM prompts WHERE session_id = 'late'")).toBe(2)
    expect(count("SELECT count(*) AS c FROM prompts WHERE uuid LIKE 'history:%'")).toBe(0)
    expect(count("SELECT count(*) AS c FROM texts WHERE key LIKE 'history:%'")).toBe(0)
  })

  it('rereads a rewritten history file without clearing the index or counting a prompt twice', async () => {
    const { fx, indexer, historyFile, count } = setup()
    fx.write('-Users-me-code-app/s1.jsonl', jsonl([prompt('hello', { sessionId: 's1' }), reply('m1', text('hi'), {}, { sessionId: 's1' })]))
    fs.writeFileSync(historyFile, jsonl([entry('old', 'one', 0), entry('old', 'two', 1), entry('old', 'three', 2)]))
    await indexer.scan()
    fs.writeFileSync(historyFile, jsonl([entry('old', 'two', 1), entry('old', 'three', 2)]))
    await indexer.scan()
    expect(count("SELECT count(*) AS c FROM prompts WHERE session_id = 'old'")).toBe(3)
    expect(count('SELECT count(*) AS c FROM api_calls')).toBe(1)
  })

  it('indexes Cowork transcripts with the title and account from their metadata', async () => {
    const { db, indexer, coworkDir } = setup()
    const dir = path.join(coworkDir, ACCOUNT, ORG)
    const session = path.join(dir, 'local_cw', '.claude', 'projects', '-sessions-quiet-vm')
    fs.mkdirSync(session, { recursive: true })
    fs.writeFileSync(path.join(dir, 'local_cw.json'), JSON.stringify({ sessionId: 'local_cw', cliSessionId: 'cw', title: 'Quarterly report', cwd: path.join(dir, 'local_cw', 'outputs') }))
    fs.writeFileSync(path.join(session, 'cw.jsonl'), jsonl([
      prompt('summarise the sheet', { sessionId: 'cw', cwd: '/sessions/quiet-vm', extra: { entrypoint: undefined } }),
      reply('m-cw', text('done'), {}, { sessionId: 'cw', cwd: '/sessions/quiet-vm' }),
    ]))
    await indexer.scan()
    const row = q.session(db, 'cw')
    expect({ title: row?.title, project: row?.projectName, source: row?.source }).toEqual({ title: 'Quarterly report', project: 'Cowork', source: 'desktop' })
    expect(listAccounts(db).find((a) => a.id === ACCOUNT)?.sessions).toBe(1)
  })
})

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { accountInfo, accountScopes, listAccounts, maskEmail } from '../server/accounts.ts'
import { UNKNOWN_ACCOUNT, openDb } from '../server/db.ts'
import { Indexer } from '../server/indexer.ts'
import { Pricing } from '../server/pricing.ts'
import * as q from '../server/queries.ts'
import { jsonl, prompt, reply, tempProjects, text } from './fixtures.ts'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const ORG = '33333333-3333-4333-8333-333333333333'
const SLUG = '-Users-me-code-app'
const configDir = process.env.CLAUDE_CONFIG_DIR

afterEach(() => {
  if (configDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = configDir
})

async function setup() {
  const fx = tempProjects()
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wiener-accounts-'))
  const desktop = path.join(home, 'claude-code-sessions')
  for (const [account, cli] of [[A, 'sa'], [B, 'sb']] as const) {
    const dir = path.join(desktop, account, ORG)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `local_${cli}.json`), JSON.stringify({ sessionId: `local_${cli}`, cliSessionId: cli, title: cli }))
  }
  for (const [id, hour] of [['sa', 10], ['sb', 11], ['sc', 12]] as const) {
    const ts = `2026-10-01T${hour}:00:00.000Z`
    fx.write(`${SLUG}/${id}.jsonl`, jsonl([prompt(id, { sessionId: id, ts }), reply(`m-${id}`, text(id), {}, { sessionId: id, ts })]))
  }
  const file = path.join(home, 'index.db')
  const db = openDb(file)
  await new Indexer(db, new Pricing(), { projectsDir: fx.root, desktopDir: desktop }).scan()
  process.env.CLAUDE_CONFIG_DIR = home
  const signIn = (name: string, accountUuid: string, emailAddress: string, tier: string) =>
    fs.writeFileSync(path.join(home, name), JSON.stringify({ oauthAccount: { accountUuid, emailAddress, organizationRateLimitTier: tier } }))
  return { db, file, signIn }
}

describe('accounts', () => {
  it('masks e-mail addresses down to what tells two accounts apart', () => {
    expect(maskEmail('adalovelace@gmail.com')).toBe('ada…@gmail.com')
    expect(maskEmail('ab@x.io')).toBe('a…@x.io')
  })

  it('lists desktop accounts by first use, then the sessions no account claims', async () => {
    const { db, signIn } = await setup()
    signIn('.claude.json', B, 'klaus@example.com', 'default_claude_max_20x')
    expect(listAccounts(db)).toEqual([
      { id: A, kind: 'account', label: 'Hesap 1', sessions: 1 },
      { id: B, kind: 'account', label: 'kla…@example.com', sessions: 1 },
      { id: UNKNOWN_ACCOUNT, kind: 'unknown', label: 'Hesabı bilinmeyen', sessions: 1 },
    ])
    expect(listAccounts(db, 'en').map((a) => a.label)).toEqual(['Account 1', 'kla…@example.com', 'Unknown account'])
  })

  it('scopes every query to the chosen account and leaves the full index alone', async () => {
    const { db, file } = await setup()
    const scope = accountScopes(db, file)
    const a = scope(A)
    const unknown = scope(UNKNOWN_ACCOUNT)
    if (!a || !unknown) throw new Error('scope missing')
    expect(q.sessions(a).rows.map((r) => r.id)).toEqual(['sa'])
    expect(a.prepare('SELECT count(*) AS c FROM api_calls').get()).toEqual({ c: 1 })
    expect(q.summary(a, []).periods.find((p) => p.key === 'all')?.messages).toBe(2)
    expect(q.sessions(unknown).rows.map((r) => r.id)).toEqual(['sc'])
    expect(q.sessions(db).total).toBe(3)
    expect(scope('ffffffff-ffff-ffff-ffff-ffffffffffff')).toBeNull()
  })

  it('adds the account column to a version 6 index in place, keeping history the transcripts no longer have', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wiener-migrate-')), 'index.db')
    const old = openDb(file)
    old.exec("INSERT INTO sessions (id, first_ts) VALUES ('kept', 1)")
    old.exec('ALTER TABLE desktop_sessions DROP COLUMN account_id; PRAGMA user_version = 6')
    old.close()
    const db = openDb(file)
    expect(db.prepare('SELECT id FROM sessions').all()).toEqual([{ id: 'kept' }])
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 7 })
    expect(db.prepare("SELECT name FROM pragma_table_info('desktop_sessions') WHERE name = 'account_id'").all()).toEqual([{ name: 'account_id' }])
  })

  it('keeps an account label and plan after the config files move to the other account', async () => {
    const { db, signIn } = await setup()
    signIn('.claude.json', A, 'alice@example.com', 'default_claude_max_5x')
    signIn('.claude.json.backup', B, 'klaus@example.com', 'default_claude_max_20x')
    expect(listAccounts(db).map((x) => x.label)).toEqual(['ali…@example.com', 'kla…@example.com', 'Hesabı bilinmeyen'])
    signIn('.claude.json.backup', A, 'alice@example.com', 'default_claude_max_5x')
    expect(listAccounts(db).map((x) => x.label)).toEqual(['ali…@example.com', 'kla…@example.com', 'Hesabı bilinmeyen'])
    expect(accountInfo(db, A).plan).toBe('Max 5x')
    expect(accountInfo(db, B)).toEqual({ plan: 'Max 20x', usage: null })
  })
})

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { accountInfo, accountScopes, listAccounts, maskEmail } from '../server/accounts.ts'
import { limits } from '../server/costs.ts'
import { UNKNOWN_ACCOUNT, openDb } from '../server/db.ts'
import { Indexer } from '../server/indexer.ts'
import { Pricing } from '../server/pricing.ts'
import * as q from '../server/queries.ts'
import { jsonl, prompt, reply, tempProjects, text } from './fixtures.ts'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const ORG = '33333333-3333-4333-8333-333333333333'
const ORG_B = '44444444-4444-4444-8444-444444444444'
const H = 3_600_000
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

  it("measures each account from the desktop app's samples for the org its own sessions live in", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wiener-usage-'))
    const desktop = path.join(home, 'claude-code-sessions')
    const put = (account: string, org: string, name: string) => {
      fs.mkdirSync(path.join(desktop, account, org), { recursive: true })
      fs.writeFileSync(path.join(desktop, account, org, name), '{}')
    }
    put(A, ORG, 'local_a.json')
    put(A, ORG_B, 'scheduled-tasks.json')
    put(B, ORG_B, 'local_b.json')
    put(B, ORG, 'scheduled-tasks.json')
    const now = Date.now()
    const ago = (minutes: number) => now - minutes * 60_000
    fs.writeFileSync(path.join(home, 'plan-usage-history.json'), JSON.stringify({
      version: 2,
      samples: [
        { t: ago(400), org: ORG, u: { fh: 90, sd: 50 } },
        { t: ago(30), org: ORG, u: { fh: 12, sd: 40, xu: 0.5 } },
        { t: ago(20), org: ORG, u: {} },
        { t: ago(10), org: ORG_B, u: { fh: 70, sd: 85 } },
      ],
    }))
    process.env.CLAUDE_CONFIG_DIR = home
    const db = openDb(':memory:')
    const a = accountInfo(db, A, desktop)
    expect(a.usage).toEqual({ fetchedAt: ago(30), fiveHour: { percent: 12, resetsAt: null }, sevenDay: { percent: 40, resetsAt: null } })
    expect(limits(db, a, now).measured).toMatchObject({ fresh: true, fiveHour: { percent: 12 }, sevenDay: { percent: 40 } })
    expect(limits(db, a, now + 5 * H).measured).toMatchObject({ fresh: true, fiveHour: null, sevenDay: { percent: 40 } })
    expect(limits(db, a, now + 6 * H).measured).toMatchObject({ fresh: false, fiveHour: null, sevenDay: null })
    expect(limits(db, accountInfo(db, B, desktop), now).measured).toMatchObject({ fresh: true, fiveHour: { percent: 70 }, sevenDay: { percent: 85 } })
    expect(accountInfo(db, UNKNOWN_ACCOUNT, desktop).usage).toBeNull()
    put(A, ORG_B, 'local_c.json')
    expect(accountInfo(db, B, desktop).usage).toBeNull()
  })
})

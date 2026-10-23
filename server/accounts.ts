import fs from 'node:fs'
import path from 'node:path'
import { type Lang, pick } from '../shared/i18n.ts'
import type { Account } from '../shared/types.ts'
import { type AccountInfo, accountFile, planOf, readAccount } from './costs.ts'
import { ACCOUNT_ID, type Db, UNKNOWN_ACCOUNT, getMeta, openAccountDb, setMeta } from './db.ts'
import type { LimitSample } from './forecast.ts'

interface LearnedAccount {
  label: string
  plan: string | null
}

export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@')
  const local = at > 0 ? email.slice(0, at) : email
  return `${local.slice(0, Math.min(3, local.length - 1))}…${at > 0 ? email.slice(at) : ''}`
}

const readMtimes = new Map<string, number>()

function learnFrom(db: Db, file: string): void {
  let mtime: number
  try {
    mtime = fs.statSync(file).mtimeMs
  } catch {
    return
  }
  if (readMtimes.get(file) === mtime) return
  try {
    const acct = ((JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>).oauthAccount ?? {}) as Record<string, unknown>
    readMtimes.set(file, mtime)
    if (typeof acct.accountUuid !== 'string' || !ACCOUNT_ID.test(acct.accountUuid) || typeof acct.emailAddress !== 'string') return
    const learned: LearnedAccount = { label: maskEmail(acct.emailAddress), plan: planOf(acct) }
    setMeta(db, `account:${acct.accountUuid}`, JSON.stringify(learned))
  } catch {
    readMtimes.delete(file)
  }
}

function learnedAccount(db: Db, id: string): LearnedAccount | null {
  const raw = getMeta(db, `account:${id}`)
  try {
    return raw ? (JSON.parse(raw) as LearnedAccount) : null
  } catch {
    return null
  }
}

export function listAccounts(db: Db, lang: Lang = 'tr'): Account[] {
  for (const file of [accountFile(), `${accountFile()}.backup`]) learnFrom(db, file)
  const rows = db
    .prepare(`SELECT d.account_id AS id, count(s.id) AS sessions FROM desktop_sessions d
      JOIN sessions s ON s.id = d.cli_session_id AND s.first_ts IS NOT NULL
      WHERE d.account_id IS NOT NULL GROUP BY d.account_id ORDER BY min(s.first_ts)`)
    .all() as { id: string; sessions: number }[]
  const accounts: Account[] = rows.map((r, i) => ({
    id: r.id, kind: 'account', label: learnedAccount(db, r.id)?.label ?? `${pick(lang, 'Hesap', 'Account')} ${i + 1}`, sessions: r.sessions,
  }))
  const unknown = db
    .prepare(`SELECT count(*) AS c FROM sessions WHERE first_ts IS NOT NULL AND id NOT IN
      (SELECT cli_session_id FROM desktop_sessions WHERE account_id IS NOT NULL AND cli_session_id IS NOT NULL)`)
    .get() as { c: number }
  if (unknown.c > 0) accounts.push({ id: UNKNOWN_ACCOUNT, kind: 'unknown', label: pick(lang, 'Hesabı bilinmeyen', 'Unknown account'), sessions: unknown.c })
  return accounts
}

const listDir = (dir: string): string[] => {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

/** Each organization whose sessions sit under exactly one account folder, and that account. */
function orgOwners(desktopDir: string): Map<string, string> {
  const holders = new Map<string, string[]>()
  for (const acct of listDir(desktopDir)) {
    for (const org of listDir(path.join(desktopDir, acct))) {
      if (listDir(path.join(desktopDir, acct, org)).some((f) => f.startsWith('local_') && f.endsWith('.json'))) holders.set(org, [...(holders.get(org) ?? []), acct])
    }
  }
  return new Map([...holders].filter(([, accts]) => accts.length === 1).map(([org, accts]) => [org, accts[0] as string]))
}

function ownOrgs(desktopDir: string, account: string): Set<string> {
  return new Set([...orgOwners(desktopDir)].filter(([, owner]) => owner === account).map(([org]) => org))
}

/**
 * The desktop app's own usage readings, about every 15 minutes while it runs, per organization:
 * how full the 5-hour and weekly limits were, without reset times. `owner` is the account the
 * organization belongs to, when that is clear.
 */
export function desktopReadings(desktopDir: string): { org: string; owner: string | null; samples: LimitSample[] }[] {
  let samples: unknown
  try {
    samples = (JSON.parse(fs.readFileSync(path.join(path.dirname(desktopDir), 'plan-usage-history.json'), 'utf8')) as Record<string, unknown>).samples
  } catch {
    return []
  }
  const owners = orgOwners(desktopDir)
  const byOrg = new Map<string, LimitSample[]>()
  const pct = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  for (const s of Array.isArray(samples) ? (samples as (Record<string, unknown> | null)[]) : []) {
    const u = (s?.u ?? {}) as Record<string, unknown>
    if (typeof s?.t !== 'number' || typeof s.org !== 'string' || (pct(u.fh) === null && pct(u.sd) === null)) continue
    const list = byOrg.get(s.org) ?? []
    list.push({ t: s.t, session: null, fh: pct(u.fh), fr: null, sd: pct(u.sd), sr: null })
    byOrg.set(s.org, list)
  }
  return [...byOrg].map(([org, list]) => ({ org, owner: owners.get(org) ?? null, samples: list.sort((a, b) => a.t - b.t) }))
}

function sampledUsage(desktopDir: string, account: string): AccountInfo['usage'] {
  const orgs = ownOrgs(desktopDir, account)
  if (!orgs.size) return null
  let samples: unknown
  try {
    samples = (JSON.parse(fs.readFileSync(path.join(path.dirname(desktopDir), 'plan-usage-history.json'), 'utf8')) as Record<string, unknown>).samples
  } catch {
    return null
  }
  const window = (v: unknown) => (typeof v === 'number' ? { percent: v, resetsAt: null } : null)
  let newest: AccountInfo['usage'] = null
  for (const s of Array.isArray(samples) ? (samples as (Record<string, unknown> | null)[]) : []) {
    const u = (s?.u ?? {}) as Record<string, unknown>
    if (typeof s?.t !== 'number' || !orgs.has(s.org as string) || (newest && s.t <= newest.fetchedAt)) continue
    if (typeof u.fh === 'number' || typeof u.sd === 'number') newest = { fetchedAt: s.t, fiveHour: window(u.fh), sevenDay: window(u.sd) }
  }
  return newest
}

export function accountInfo(db: Db, account: string, desktopDir: string | null = null): AccountInfo {
  const info = readAccount(undefined, account) ?? { plan: learnedAccount(db, account)?.plan ?? null, usage: null }
  const sampled = desktopDir ? sampledUsage(desktopDir, account) : null
  return sampled && sampled.fetchedAt > (info.usage?.fetchedAt ?? 0) ? { ...info, usage: sampled } : info
}

export function accountScopes(db: Db, file: string): (account: string) => Db | null {
  const opened = new Map<string, Db>()
  const known = db.prepare('SELECT 1 FROM desktop_sessions WHERE account_id = ? LIMIT 1')
  return (account) => {
    if (account !== UNKNOWN_ACCOUNT && !known.get(account)) return null
    let scoped = opened.get(account)
    if (!scoped) opened.set(account, (scoped = openAccountDb(file, account)))
    return scoped
  }
}

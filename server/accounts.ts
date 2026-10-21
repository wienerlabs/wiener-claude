import fs from 'node:fs'
import { type Lang, pick } from '../shared/i18n.ts'
import type { Account } from '../shared/types.ts'
import { type AccountInfo, accountFile, planOf, readAccount } from './costs.ts'
import { ACCOUNT_ID, type Db, UNKNOWN_ACCOUNT, getMeta, openAccountDb, setMeta } from './db.ts'

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

export function accountInfo(db: Db, account: string): AccountInfo {
  return readAccount(undefined, account) ?? { plan: learnedAccount(db, account)?.plan ?? null, usage: null }
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

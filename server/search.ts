import type { SearchMatch } from '../shared/types.ts'
import { type Db, foldTurkish } from './db.ts'

const MARK_OPEN = '\u0002'
const MARK_CLOSE = '\u0003'

/**
 * Turns what someone typed into a safe FTS5 query: every word must appear, and the last word
 * of a half-typed query still matches as a prefix. Quoting each word disarms FTS syntax.
 */
export function ftsQuery(input: string): string | null {
  const words = foldTurkish(input)
    .split(/\s+/)
    .map((w) => w.replace(/["*]/g, '').trim())
    .filter((w) => w.length > 0)
    .slice(0, 8)
  if (words.length === 0) return null
  return words.map((w) => `"${w}"*`).join(' ')
}

export interface SessionHits {
  /** Best match first. */
  order: string[]
  bySession: Map<string, { bestId: number; rank: number; hits: number }>
}

const MAX_ROWS = 5000

/** Sessions whose prompts, replies or commands match, ranked by their best match. */
export function searchSessions(db: Db, query: string): SessionHits {
  const fts = ftsQuery(query)
  const bySession = new Map<string, { bestId: number; rank: number; hits: number }>()
  const order: string[] = []
  if (!fts) return { order, bySession }
  const rows = db
    .prepare(`SELECT t.id AS id, t.session_id AS session_id, bm25(texts_fts) AS rank
      FROM texts_fts JOIN texts t ON t.id = texts_fts.rowid
      WHERE texts_fts MATCH ? ORDER BY rank LIMIT ${MAX_ROWS}`)
    .all(fts) as { id: number; session_id: string; rank: number }[]
  for (const r of rows) {
    const s = bySession.get(r.session_id)
    if (s) s.hits++
    else {
      bySession.set(r.session_id, { bestId: r.id, rank: r.rank, hits: 1 })
      order.push(r.session_id)
    }
  }
  return { order, bySession }
}

/** The snippet for one text row, with hits marked, cut from the original text. */
export function matchFor(db: Db, query: string, textId: number, hits: number): SearchMatch | null {
  const row = db.prepare('SELECT key, kind, ts, text FROM texts WHERE id = ?').get(textId) as
    | { key: string; kind: SearchMatch['kind']; ts: number; text: string }
    | undefined
  if (!row) return null
  return { key: row.key, kind: row.kind, ts: row.ts, hits, snippet: snippetFrom(row.text, hitRanges(row.text, query)) }
}

/** One character folded the way the FTS tokenizer folds it: no accents, lower case, ı and İ as i. */
function foldChar(ch: string): string {
  if (ch === 'ı' || ch === 'İ') return 'i'
  return ch.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase()
}

const WORD = /[\p{L}\p{N}]+/gu

function foldedWords(text: string): string[] {
  const folded = [...text].map(foldChar).join('')
  return folded.match(WORD) ?? []
}

/**
 * Where the query's words appear in `text`, as [start, end) offsets into the original string.
 * FTS5 picks the rows; marking the words here instead of with highlight() keeps the offsets
 * exact for the original text (highlight() proved unreliable combined with a rowid filter).
 */
export function hitRanges(text: string, query: string): [number, number][] {
  const words = [...new Set(foldedWords(query))]
  if (words.length === 0) return []
  // Fold character by character, remembering which original offset each folded char came from.
  let folded = ''
  const from: number[] = []
  const to: number[] = []
  let offset = 0
  for (const ch of text) {
    const f = foldChar(ch)
    for (let i = 0; i < f.length; i++) {
      from.push(offset)
      to.push(offset + ch.length)
    }
    folded += f
    offset += ch.length
  }
  const ranges: [number, number][] = []
  for (const m of folded.matchAll(WORD)) {
    const token = m[0]
    if (!words.some((w) => token.startsWith(w))) continue
    const start = m.index ?? 0
    ranges.push([from[start] ?? 0, to[start + token.length - 1] ?? text.length])
  }
  return ranges
}

/** Text around the first hit, with every hit inside it wrapped in markers. */
export function snippetFrom(original: string, ranges: [number, number][], before = 60, after = 160): string {
  const first = ranges[0]
  if (!first) return clean(original.slice(0, before + after)) + (original.length > before + after ? '…' : '')
  let start = Math.max(0, first[0] - before)
  let end = Math.min(original.length, first[1] + after)
  // Don't cut words in half.
  if (start > 0) {
    const space = original.lastIndexOf(' ', start)
    if (space > start - 20) start = space + 1
  }
  if (end < original.length) {
    const space = original.indexOf(' ', end)
    if (space !== -1 && space < end + 20) end = space
  }
  let out = ''
  let cursor = start
  for (const [a, b] of ranges) {
    if (b <= start || a >= end || a < cursor) continue
    const e = Math.min(b, end)
    out += original.slice(cursor, a) + MARK_OPEN + original.slice(a, e) + MARK_CLOSE
    cursor = e
  }
  out += original.slice(cursor, end)
  return `${start > 0 ? '…' : ''}${clean(out)}${end < original.length ? '…' : ''}`
}

const clean = (t: string) => t.replace(/\s+/g, ' ').trim()

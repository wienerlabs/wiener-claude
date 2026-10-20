// The English demo mirrors the Turkish one. The generator draws from a seeded RNG while it walks the
// stories, so the two must have the same shape (same keys, lengths, numbers, files, line counts) for
// a visitor in either language to get the same sessions, ids, timestamps and costs.
import { describe, expect, it } from 'vitest'
import { WEB_EXTRA_EN } from '../scripts/demo/stories-web.en.ts'
import { WEB_EXTRA } from '../scripts/demo/stories-web.ts'
import { CLAUDE_MD_WEB_EN, ROUTINE_PR_EN, ROUTINE_TESTS_EN, STORIES_EN } from '../scripts/demo/stories.en.ts'
import { CLAUDE_MD_WEB, ROUTINE_PR, ROUTINE_TESTS, STORIES } from '../scripts/demo/stories.ts'

/** Values the generator keys on or shows as they are: identical in both languages. */
const IDENTITY = new Set(['name', 'repo', 'file', 'read', 'branch', 'model', 'skill', 'command', 'instead', 'id', 'kind', 'grep'])

/** Turkish words the English demo keeps: the company, the currency's subunit, and places. */
const KEEP = ['Çarşı', 'kuruş', 'Kadıköy', 'Gökçeada']
/** A real locale file: what goes into it stays Turkish. */
const TURKISH_FILE = 'messages/tr.json'
const TURKISH = /[çğıöşüÇĞİÖŞÜ]/

const lines = (s: string) => s.split('\n').length

/** Where the English tree drifts from the Turkish one, one readable line each; empty when it mirrors. */
function drift(tr: unknown, en: unknown, path: string[] = [], out: string[] = []): string[] {
  const at = path.join('.') || '(root)'
  const key = path.findLast((p) => !/^\d+$/.test(p)) ?? ''
  const kind = (x: unknown) => (x === null ? 'null' : Array.isArray(x) ? 'array' : typeof x)
  if (kind(tr) !== kind(en)) {
    out.push(`${at}: ${kind(tr)} in Turkish, ${kind(en)} in English`)
  } else if (typeof tr === 'string' && typeof en === 'string') {
    if (IDENTITY.has(key) || (key === 'value' && /^https?:\/\//.test(tr))) {
      if (tr !== en) out.push(`${at}: must stay ${JSON.stringify(tr)}`)
    } else if (lines(tr) !== lines(en)) {
      out.push(`${at}: ${lines(tr)} lines in Turkish, ${lines(en)} in English`)
    }
  } else if (Array.isArray(tr) && Array.isArray(en)) {
    if (tr.length !== en.length) out.push(`${at}: ${tr.length} items in Turkish, ${en.length} in English`)
    for (let i = 0; i < Math.min(tr.length, en.length); i++) drift(tr[i], en[i], [...path, String(i)], out)
  } else if (kind(tr) === 'object') {
    const a = tr as Record<string, unknown>
    const b = en as Record<string, unknown>
    for (const k of Object.keys(a)) if (!(k in b)) out.push(`${at}: "${k}" missing in English`)
    for (const k of Object.keys(b)) if (!(k in a)) out.push(`${at}: "${k}" only in English`)
    for (const k of Object.keys(a)) if (k in b) drift(a[k], b[k], [...path, k], out)
  } else if (tr !== en) {
    out.push(`${at}: ${String(tr)} in Turkish, ${String(en)} in English`)
  }
  return out
}

/** Every string in the tree that should be English, with where it sits. */
function texts(node: unknown, path: string[] = [], out: { at: string; text: string }[] = []) {
  if (typeof node === 'string') out.push({ at: path.join('.'), text: node })
  else if (Array.isArray(node)) node.forEach((x, i) => texts(x, [...path, String(i)], out))
  else if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>
    for (const [k, v] of Object.entries(o)) {
      if (o.file === TURKISH_FILE && (k === 'old' || k === 'new')) continue
      if (path.at(-1) === 'snippets' && k === TURKISH_FILE) continue
      texts(v, [...path, k], out)
    }
  }
  return out
}

describe('English demo stories', () => {
  it('catches a copy that drifts', () => {
    expect(drift({ a: 'x\ny', file: 'a.ts', n: [1] }, { a: 'x', file: 'b.ts', n: [1, 2] })).toHaveLength(3)
  })

  it('mirror the Turkish stories', () => {
    expect(drift(STORIES, STORIES_EN)).toEqual([])
    expect(drift(WEB_EXTRA, WEB_EXTRA_EN)).toEqual([])
    expect(drift({ ROUTINE_TESTS, ROUTINE_PR, CLAUDE_MD_WEB }, { ROUTINE_TESTS: ROUTINE_TESTS_EN, ROUTINE_PR: ROUTINE_PR_EN, CLAUDE_MD_WEB: CLAUDE_MD_WEB_EN })).toEqual([])
  })

  it('keep their titles unique', () => {
    const titles = STORIES_EN.flatMap((p) => [...p.stories, ...p.questions].map((x) => x.title))
    expect(titles.length).toBeGreaterThan(40)
    expect(titles.filter((t, i) => titles.indexOf(t) !== i)).toEqual([])
  })

  it('are written in English', () => {
    const all = texts({ STORIES_EN, ROUTINE_TESTS_EN, ROUTINE_PR_EN, CLAUDE_MD_WEB_EN })
    const turkish = all.filter(({ text }) => TURKISH.test(KEEP.reduce((s, w) => s.replaceAll(w, ''), text))).map(({ at }) => at)
    expect(turkish).toEqual([])
  })

  it('leave the last task open exactly where the work goes on in another PR', () => {
    for (const s of STORIES.flatMap((p) => p.stories)) expect([s.title, !!s.leavesTaskOpen]).toEqual([s.title, s.summary.includes('ayrı bir PR')])
  })
})

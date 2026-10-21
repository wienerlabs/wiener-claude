// Advice built from the transcripts. Every tip says what was seen, why it matters, what to do
// and which sessions it rests on; a tip shows only when its signal is clear in the range.
import os from 'node:os'
import path from 'node:path'
import { type Lang, compactNumber, formatInt, pick } from '../shared/i18n.ts'
import type { InstructionFile, McpServer, RangeKey, Tip, TipsReport } from '../shared/types.ts'
import { withPossessive } from '../shared/tr.ts'
import { classifyError, commandSignature, type SetupError } from './commands.ts'
import { money as moneyIn, period } from './costs.ts'
import type { Db } from './db.ts'
import { instructionFiles, mcpServerList } from './env.ts'
import { type Pricing, normalizeModel } from './pricing.ts'
import { rangeBounds } from './range.ts'

type Row = Record<string, unknown>
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

const TITLE = `COALESCE(NULLIF(s.custom_title, ''), NULLIF(d.title, ''), NULLIF(s.ai_title, ''), NULLIF(s.first_prompt, ''), 'Adsız oturum')`
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s)

/** Context above this is where the cost of re-reading starts to dominate. */
const BIG_CONTEXT = 200_000
/** What a compacted or fresh conversation typically carries. */
const LEAN_CONTEXT = 150_000
/** A rewrite this large means the whole conversation went back into the cache. */
const BIG_REWRITE = 50_000
/** Roughly what a conversation is after /compact. */
const COMPACTED = 30_000
const PREMIUM = /^claude-(opus|fable|mythos)/
const CHEAPER = 'claude-sonnet-5-5'
const CHEAPER_NAME = 'Sonnet 5.5'

interface Ctx {
  db: Db
  pricing: Pricing
  lang: Lang
  key: RangeKey
  from: string
  to: string
  lead: string
  inline: string
  p: { $from: string; $to: string }
  env: TipsEnv
}

/** What lives outside the index. Tests pass their own; the server reads ~/.claude. */
export interface TipsEnv {
  instructions: (InstructionFile & { path: string })[]
  mcp: McpServer[]
}

/** Text and numbers in the report's language. */
function words(lang: Lang) {
  const count = (v: number) => formatInt(v, lang)
  return {
    /** The Turkish or the English text. */
    L: <T>(tr: T, en: T): T => pick(lang, tr, en),
    count,
    money: (v: number) => moneyIn(v, lang),
    compact: (v: number) => compactNumber(v, lang),
    /** English only: "1 session", "3 sessions". */
    many: (v: number, one: string, other = `${one}s`) => `${count(v)} ${Math.round(v) === 1 ? one : other}`,
    /** English only: "once", "3 times". */
    howOften: (v: number) => (Math.round(v) === 1 ? 'once' : `${count(v)} times`),
  }
}

/** English only: "a", "a and b", "a, b, and c". */
function andList(items: string[]): string {
  if (items.length <= 2) return items.join(' and ')
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

function titles(db: Db, ids: string[]): Map<string, string> {
  if (ids.length === 0) return new Map()
  const rows = db.prepare(`SELECT s.id AS id, ${TITLE} AS title FROM sessions s LEFT JOIN desktop_sessions d ON d.cli_session_id = s.id
    WHERE s.id IN (${ids.map(() => '?').join(', ')})`).all(...ids) as Row[]
  return new Map(rows.map((r) => [String(r.id), clip(String(r.title), 90)]))
}

function prices(ctx: Ctx, model: string) {
  const p = ctx.pricing.prices[normalizeModel(model)]
  if (!p) return null
  return { read: p.cacheRead, write5m: p.cacheWrite5m ?? p.input * 1.25, write1h: p.cacheWrite1h ?? p.input * 2 }
}

function costIn(ctx: Ctx): number {
  return n((ctx.db.prepare('SELECT COALESCE(sum(cost), 0) AS c FROM api_calls WHERE day BETWEEN $from AND $to').get(ctx.p) as Row).c)
}

// ---- money --------------------------------------------------------------------------------------

function contextTip(ctx: Ctx): Tip | null {
  const rows = ctx.db.prepare(`SELECT session_id, model, count(*) AS calls, sum(cost) AS cost,
      sum(MAX(input + cache_read + cache_write_5m + cache_write_1h - ${LEAN_CONTEXT}, 0)) AS over,
      max(input + cache_read + cache_write_5m + cache_write_1h) AS peak
    FROM api_calls WHERE day BETWEEN $from AND $to AND input + cache_read + cache_write_5m + cache_write_1h > ${BIG_CONTEXT}
    GROUP BY session_id, model`).all(ctx.p) as Row[]
  const total = costIn(ctx)
  const big = rows.reduce((s, r) => s + n(r.cost), 0)
  if (total < 1 || big / total < 0.25) return null
  const calls = rows.reduce((s, r) => s + n(r.calls), 0)
  const peak = Math.max(...rows.map((r) => n(r.peak)))
  // Reading the part above LEAN_CONTEXT: what compacting earlier could have saved at most.
  const saving = rows.reduce((s, r) => s + (n(r.over) * (prices(ctx, String(r.model))?.read ?? 0)) / 1e6, 0)

  const bySession = new Map<string, { cost: number; peak: number }>()
  for (const r of rows) {
    const e = bySession.get(String(r.session_id)) ?? { cost: 0, peak: 0 }
    e.cost += n(r.cost)
    e.peak = Math.max(e.peak, n(r.peak))
    bySession.set(String(r.session_id), e)
  }
  const top = [...bySession].sort((a, b) => b[1].cost - a[1].cost).slice(0, 5)
  const names = titles(ctx.db, top.map(([id]) => id))
  const { L, count, money, compact, many } = words(ctx.lang)
  const share = (big / total) * 100
  return {
    kind: 'context',
    title: L('Context şişmesi', 'Context bloat'),
    finding: L(
      `${ctx.lead} maliyetin ${withPossessive(share, '%')} (${money(big)}) context'i 200 bin token'ı aşan ${count(calls)} çağrıdan geldi. En büyük context ${compact(peak)} token'a ulaştı.`,
      `${ctx.lead}, ${Math.round(share)}% of your cost (${money(big)}) came from ${many(calls, 'call')} with more than 200K tokens of context. The largest context reached ${compact(peak)} tokens.`,
    ),
    why: L(
      "Claude her istekte konuşmanın tamamını cache'ten yeniden okur. Context büyüdükçe her mesaj, istenen iş ne kadar küçük olursa olsun, pahalılaşır.",
      'With every request, Claude reads the whole conversation again from the cache. The bigger the context, the more each message costs, however small the task.',
    ),
    action: L(
      "Konu değişince yeni oturum aç. Uzun bir işin ortasındaysan context 150 bin token civarına geldiğinde /compact ile konuşmayı özetle.",
      "Start a new session when you switch topics. If you're in the middle of a long task, run /compact to summarize the conversation when the context reaches about 150K tokens.",
    ),
    saving,
    savingKind: 'upTo',
    examples: top.map(([id, e]) => ({
      label: names.get(id) ?? id,
      detail: L(`${money(e.cost)} · en büyük context ${compact(e.peak)} token`, `${money(e.cost)} · largest context ${compact(e.peak)} tokens`),
      sessionId: id,
    })),
    snippet: null,
  }
}

function cacheRewriteTip(ctx: Ctx): Tip | null {
  const rows = ctx.db.prepare(`WITH c AS (
      SELECT session_id, model, ts, cache_write_5m, cache_write_1h, LAG(ts) OVER (PARTITION BY session_id ORDER BY ts) AS prev
      FROM api_calls WHERE is_sidechain = 0 AND day BETWEEN $from AND $to
    )
    SELECT session_id, model, count(*) AS times, sum(cache_write_5m) AS w5, sum(cache_write_1h) AS w1
    FROM c WHERE prev IS NOT NULL AND ts - prev > 300000 AND cache_write_5m + cache_write_1h > ${BIG_REWRITE}
    GROUP BY session_id, model`).all(ctx.p) as Row[]
  let cost = 0
  let saving = 0
  let times = 0
  const bySession = new Map<string, { times: number; cost: number }>()
  for (const r of rows) {
    const pr = prices(ctx, String(r.model))
    if (!pr) continue
    const w5 = n(r.w5)
    const w1 = n(r.w1)
    const c = (w5 * pr.write5m + w1 * pr.write1h) / 1e6
    const rate = w5 + w1 > 0 ? c / (w5 + w1) : 0
    cost += c
    saving += Math.max(w5 + w1 - COMPACTED * n(r.times), 0) * rate
    times += n(r.times)
    const e = bySession.get(String(r.session_id)) ?? { times: 0, cost: 0 }
    e.times += n(r.times)
    e.cost += c
    bySession.set(String(r.session_id), e)
  }
  if (cost < 2 || times < 3) return null
  const top = [...bySession].sort((a, b) => b[1].cost - a[1].cost).slice(0, 5)
  const names = titles(ctx.db, top.map(([id]) => id))
  const { L, count, money, howOften } = words(ctx.lang)
  return {
    kind: 'cache-rewrite',
    title: L("Aradan sonra yeniden yazılan cache", 'Cache rewritten after breaks'),
    finding: L(
      `${ctx.lead} konuşma ${count(times)} kez 5 dakikadan uzun bir aradan sonra devam etti ve context'in tamamı cache'e yeniden yazıldı. Bu yazmalar ${money(cost)} tuttu.`,
      `${ctx.lead}, the whole context was written to the cache again ${howOften(times)} after a break of more than 5 minutes. Those writes cost ${money(cost)}.`,
    ),
    why: L(
      "Cache 5 dakika ya da 1 saat kullanılmayınca düşer. Aradan sonraki ilk mesaj bütün konuşmayı yeniden yazar ve cache'e yazmak, okumaktan kat kat pahalıdır.",
      'The cache expires once it goes unused for 5 minutes or 1 hour. The first message after a break writes the whole conversation to the cache again, and cache writes cost many times more than cache reads.',
    ),
    action: L(
      "Uzun bir aradan sonra başka bir işe geçeceksen yeni oturum aç. Aynı işe döneceksen ara vermeden önce /compact yap; yeniden yazılan context küçük olur.",
      "If you're moving on to something else after a long break, start a new session. If you're coming back to the same task, run /compact before you step away so there's less context to rewrite.",
    ),
    saving,
    savingKind: 'about',
    examples: top.map(([id, e]) => ({
      label: names.get(id) ?? id,
      detail: L(`${count(e.times)} kez · ${money(e.cost)}`, `${howOften(e.times)} · ${money(e.cost)}`),
      sessionId: id,
    })),
    snippet: null,
  }
}

function claudeMdTip(ctx: Ctx): Tip | null {
  const home = os.homedir()
  const found: { file: string; tokens: number; calls: number; cost: number; saving: number }[] = []
  for (const f of ctx.env.instructions) {
    // About four bytes per token; Turkish text runs a little higher, so this errs low.
    const tokens = Math.round(f.size / 4)
    if (tokens < 2_000) continue
    const user = f.scopeKind === 'user'
    const root = path.basename(path.dirname(f.path)) === '.claude' ? path.dirname(path.dirname(f.path)) : path.dirname(f.path)
    const rows = (user
      ? ctx.db.prepare('SELECT model, count(*) AS calls FROM api_calls WHERE day BETWEEN $from AND $to GROUP BY model').all(ctx.p)
      : ctx.db.prepare(`SELECT model, count(*) AS calls FROM api_calls WHERE day BETWEEN $from AND $to
          AND session_id IN (SELECT id FROM sessions WHERE project_key = $root) GROUP BY model`).all({ ...ctx.p, $root: root })) as Row[]
    let calls = 0
    let cost = 0
    for (const r of rows) {
      calls += n(r.calls)
      cost += (tokens * n(r.calls) * (prices(ctx, String(r.model))?.read ?? 0)) / 1e6
    }
    if (cost < 0.5) continue
    found.push({ file: f.path.startsWith(`${home}/`) ? `~/${f.path.slice(home.length + 1)}` : f.path, tokens, calls, cost, saving: cost * (1 - 2_000 / tokens) })
  }
  if (found.length === 0) return null
  found.sort((a, b) => b.cost - a.cost)
  const first = found[0] as (typeof found)[number]
  const { L, count, money, compact, many } = words(ctx.lang)
  return {
    kind: 'claude-md',
    title: L('Uzun CLAUDE.md', 'Long CLAUDE.md'),
    finding: L(
      `${first.file} yaklaşık ${compact(first.tokens)} token. ${ctx.lead} ${count(first.calls)} istekte her seferinde okundu ve yaklaşık ${money(first.cost)} tuttu.`,
      `${first.file} is about ${compact(first.tokens)} tokens. ${ctx.lead}, it was read again with each of ${many(first.calls, 'request')}, at a cost of about ${money(first.cost)}.`,
    ),
    why: L(
      'CLAUDE.md her isteğin başına eklenir. Uzun bir dosya her mesajda yeniden okunur ve dikkat edilmesi gereken kuralları da sulandırır.',
      'CLAUDE.md is added to the start of every request. A long file is read again with every message, and it dilutes the rules Claude needs to pay attention to.',
    ),
    action: L(
      "Her oturumda gereken kuralları kısa tut. Uzun belgeleri ayrı dosyalara taşı ve CLAUDE.md'de yalnızca adlarını an; Claude gerektiğinde okur.",
      'Keep the rules every session needs short. Move long documents into separate files and only mention them by name in CLAUDE.md; Claude reads them when it needs to.',
    ),
    saving: found.reduce((s, f) => s + f.saving, 0),
    savingKind: 'upTo',
    examples: found.slice(0, 5).map((f) => ({
      label: f.file,
      detail: L(
        `${compact(f.tokens)} token · ${count(f.calls)} istek · ${money(f.cost)}`,
        `${compact(f.tokens)} tokens · ${many(f.calls, 'request')} · ${money(f.cost)}`,
      ),
      mono: true,
    })),
    snippet: null,
  }
}

interface Sums {
  model: string
  input: number
  output: number
  cache_read: number
  cache_write_5m: number
  cache_write_1h: number
  cost: number
}

const asCheaper = (ctx: Ctx, rows: Sums[]) =>
  rows.reduce(
    (s, r) =>
      s +
      (ctx.pricing.cost(CHEAPER, {
        input: r.input, output: r.output, cacheRead: r.cache_read, cacheWrite5m: r.cache_write_5m, cacheWrite1h: r.cache_write_1h, webSearch: 0, fast: false,
      }) ?? 0),
    0,
  )

const SUMS = `model, sum(input) AS input, sum(output) AS output, sum(cache_read) AS cache_read,
  sum(cache_write_5m) AS cache_write_5m, sum(cache_write_1h) AS cache_write_1h, COALESCE(sum(cost), 0) AS cost`

function lightSessionsTip(ctx: Ctx): Tip | null {
  // Sessions that barely touched a tool: questions and answers, not code work.
  const rows = ctx.db.prepare(`SELECT session_id, ${SUMS} FROM api_calls
    WHERE day BETWEEN $from AND $to
      AND session_id NOT IN (SELECT session_id FROM tool_uses WHERE name IS NOT NULL GROUP BY session_id HAVING count(*) > 5)
    GROUP BY session_id, model`).all(ctx.p) as unknown as (Sums & { session_id: string })[]
  const premium = rows.filter((r) => PREMIUM.test(normalizeModel(r.model)))
  const bySession = new Map<string, { cost: number; alt: number }>()
  for (const r of premium) {
    const e = bySession.get(r.session_id) ?? { cost: 0, alt: 0 }
    e.cost += r.cost
    e.alt += asCheaper(ctx, [r])
    bySession.set(r.session_id, e)
  }
  const cost = [...bySession.values()].reduce((s, e) => s + e.cost, 0)
  const alt = [...bySession.values()].reduce((s, e) => s + e.alt, 0)
  if (cost - alt < 1) return null
  const top = [...bySession].sort((a, b) => b[1].cost - a[1].cost).slice(0, 5)
  const names = titles(ctx.db, top.map(([id]) => id))
  const { L, count, money, many } = words(ctx.lang)
  const sessions = bySession.size
  return {
    kind: 'light-sessions',
    title: L('Hafif işler için büyük model', 'A large model for light work'),
    finding: L(
      `${ctx.lead} ${count(sessions)} oturum neredeyse hiç araç kullanmadan, soru-cevap gibi geçti ve büyük modelle ${money(cost)} tuttu. Aynı token'lar ${CHEAPER_NAME} ile yaklaşık ${money(alt)} olurdu.`,
      `${ctx.lead}, ${many(sessions, 'session')} ${sessions === 1 ? 'was' : 'were'} mostly questions and answers, with almost no tool use, and cost ${money(cost)} on a large model. The same tokens would have cost about ${money(alt)} with ${CHEAPER_NAME}.`,
    ),
    why: L(
      `Kod yazmayan, dosya okumayan kısa işlerde ${CHEAPER_NAME} çoğu zaman yeterli ve daha ucuz.`,
      `For short tasks that don't write code or read files, ${CHEAPER_NAME} is usually enough, and it costs less.`,
    ),
    action: L(
      `Böyle işlere /model ile ${CHEAPER_NAME}'e geçerek başla. Soru zorsa büyük modelde kal; bu ipucu yalnızca kullanım şekline bakıyor, sorunun zorluğunu bilemez.`,
      `Start tasks like these by switching to ${CHEAPER_NAME} with /model. If the question is hard, stay on the large model: this tip only looks at how a session went and can't tell how hard the question was.`,
    ),
    saving: cost - alt,
    savingKind: 'about',
    examples: top.map(([id, e]) => ({
      label: names.get(id) ?? id,
      detail: L(`${money(e.cost)} · ${CHEAPER_NAME} ile ${money(e.alt)}`, `${money(e.cost)} · ${money(e.alt)} with ${CHEAPER_NAME}`),
      sessionId: id,
    })),
    snippet: null,
  }
}

function subagentModelTip(ctx: Ctx): Tip | null {
  const rows = (ctx.db.prepare(`SELECT ${SUMS} FROM api_calls WHERE is_sidechain = 1 AND day BETWEEN $from AND $to GROUP BY model`)
    .all(ctx.p) as unknown as Sums[]).filter((r) => PREMIUM.test(normalizeModel(r.model)))
  const cost = rows.reduce((s, r) => s + r.cost, 0)
  const alt = asCheaper(ctx, rows)
  if (cost - alt < 5) return null
  const types = (ctx.db.prepare(`SELECT detail AS name, count(*) AS calls FROM tool_uses WHERE name IN ('Agent', 'Task') AND detail IS NOT NULL
    AND day BETWEEN $from AND $to GROUP BY detail ORDER BY calls DESC LIMIT 5`).all(ctx.p) as Row[])
  const { L, count, money, many } = words(ctx.lang)
  return {
    kind: 'subagent-model',
    title: L("Subagent'lar için model", 'Model for subagents'),
    finding: L(
      `Subagent çağrıları ${ctx.inline} büyük modelle ${money(cost)} tuttu. ${CHEAPER_NAME} ile yaklaşık ${money(alt)} olurdu.`,
      `${ctx.lead}, subagent calls on a large model cost ${money(cost)}. With ${CHEAPER_NAME}, they would have cost about ${money(alt)}.`,
    ),
    why: L(
      `Arama, keşif ve özetleme gibi subagent işlerinde ${CHEAPER_NAME} genellikle yeterli.`,
      `For subagent work such as searching, exploring, and summarizing, ${CHEAPER_NAME} is usually enough.`,
    ),
    action: L(
      "Kendi subagent tanımlarına model: sonnet ekle. Ağır iş yapan subagent'ları büyük modelde bırak.",
      'Add model: sonnet to your own subagent definitions. Keep subagents that do heavy work on the large model.',
    ),
    saving: cost - alt,
    savingKind: 'about',
    examples: types.map((r) => ({ label: String(r.name), detail: L(`${count(n(r.calls))} çağrı`, many(n(r.calls), 'call')), mono: true })),
    snippet: L(
      { label: '.claude/agents/arastirmaci.md', code: '---\nname: arastirmaci\ndescription: Kod tabanında arama ve keşif\nmodel: sonnet\n---\n' },
      { label: '.claude/agents/researcher.md', code: '---\nname: researcher\ndescription: Searches and explores the codebase\nmodel: sonnet\n---\n' },
    ),
  }
}

function fastModeTip(ctx: Ctx): Tip | null {
  const rows = ctx.db.prepare(`SELECT model, count(*) AS calls, COALESCE(sum(cost), 0) AS cost FROM api_calls
    WHERE fast = 1 AND day BETWEEN $from AND $to GROUP BY model`).all(ctx.p) as Row[]
  let extra = 0
  let calls = 0
  for (const r of rows) {
    const mult = ctx.pricing.prices[normalizeModel(String(r.model))]?.fastMultiplier ?? 1
    extra += n(r.cost) - n(r.cost) / mult
    calls += n(r.calls)
  }
  if (extra < 1) return null
  const { L, count, money, many } = words(ctx.lang)
  return {
    kind: 'fast-mode',
    title: L('Fast mode farkı', 'Fast mode premium'),
    finding: L(
      `Fast mode ${ctx.inline} ${count(calls)} istekte ${money(extra)} fazladan tuttu.`,
      `${ctx.lead}, fast mode added ${money(extra)} to the cost of ${many(calls, 'request')}.`,
    ),
    why: L('Fast mode aynı modeli daha hızlı çalıştırır ama fiyatı katlar.', 'Fast mode runs the same model faster, but at a multiple of the price.'),
    action: L(
      'Beklemenin sorun olmadığı işlerde /fast ile kapat; hızın gerçekten önemli olduğu anlara sakla.',
      'Turn it off with /fast for work where waiting is fine, and save it for when speed really matters.',
    ),
    saving: extra,
    savingKind: 'about',
    examples: [],
    snippet: null,
  }
}

// ---- friction -----------------------------------------------------------------------------------

/** Lowercase, no punctuation, single spaces: two prompts typed the same way match. */
export function normalizePrompt(text: string): string {
  return text.toLocaleLowerCase('tr').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
}

const ASCII: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' }
const slug = (normalized: string, fallback: string) =>
  normalized.split(' ').slice(0, 3).join('-').replace(/[çğıöşü]/g, (c) => ASCII[c] ?? c).replace(/[^a-z0-9-]/g, '') || fallback

function repeatedPromptsTip(ctx: Ctx): Tip | null {
  const rows = ctx.db.prepare(`SELECT preview, session_id FROM prompts WHERE kind = 'prompt' AND day BETWEEN $from AND $to ORDER BY ts`).all(ctx.p) as Row[]
  const groups = new Map<string, { text: string; times: number; sessions: Set<string> }>()
  for (const r of rows) {
    const text = String(r.preview)
    const key = normalizePrompt(text)
    // Short replies ("devam et", "evet") are conversation, not a reusable instruction.
    if (key.length < 30) continue
    const g = groups.get(key) ?? { text, times: 0, sessions: new Set<string>() }
    g.times++
    g.sessions.add(String(r.session_id))
    groups.set(key, g)
  }
  const repeated = [...groups].filter(([, g]) => g.times >= 3 && g.sessions.size >= 2).sort((a, b) => b[1].times - a[1].times)
  if (repeated.length === 0) return null
  const [firstKey, first] = repeated[0] as (typeof repeated)[number]
  const { L, count, many, howOften } = words(ctx.lang)
  const one = repeated.length === 1
  return {
    kind: 'repeated-prompts',
    title: L("Tekrar tekrar yazdığın prompt'lar", 'Prompts you keep retyping'),
    finding: L(
      `${count(repeated.length)} prompt'u birden fazla oturumda aynen yeniden yazmışsın. En sık olanı ${count(first.times)} kez, ${count(first.sessions.size)} oturumda.`,
      `You retyped ${one ? 'a prompt' : many(repeated.length, 'prompt')} word for word in more than one session. ${one ? 'It' : 'The most frequent one'} came up ${howOften(first.times)} across ${many(first.sessions.size, 'session')}.`,
    ),
    why: L(
      "Her seferinde yazmak zaman alır ve küçük ifade farkları Claude'un davranışını değiştirir.",
      'Typing them out each time takes time, and small differences in wording change what Claude does.',
    ),
    action: L(
      "Bunları slash komutu yap: ~/.claude/commands/ klasörüne bir .md dosyası koyunca /dosya-adı ile çağrılır. Her oturumda geçerli olması gereken bir kuralsa CLAUDE.md'ye yaz.",
      "Turn them into slash commands: put a .md file in ~/.claude/commands/ and run it with /file-name. If it's a rule that should apply in every session, add it to CLAUDE.md instead.",
    ),
    saving: null,
    savingKind: null,
    examples: repeated.slice(0, 5).map(([, g]) => ({
      label: clip(g.text, 160),
      detail: L(`${count(g.times)} kez · ${count(g.sessions.size)} oturum`, `${howOften(g.times)} · ${many(g.sessions.size, 'session')}`),
    })),
    snippet: { label: `~/.claude/commands/${slug(firstKey, L('komut', 'command'))}.md`, code: `${first.text.replace(/…$/, '')}\n` },
  }
}

const DENIAL: Record<string, Record<Lang, string>> = {
  'user-rejected': { tr: 'sen reddettin', en: 'rejected by you' },
  'automode-blocked': { tr: 'auto mode engelledi', en: 'blocked by auto mode' },
  'automode-unavailable': { tr: 'auto mode kapalıydı', en: 'auto mode unavailable' },
}

const toolLabel = (name: string) => (name.startsWith('mcp__') ? name.split('__').slice(1).join(' › ') : name)

function denialsTip(ctx: Ctx): Tip | null {
  // A deny rule doing its job and a call cut short by an interrupt are not friction.
  const rows = ctx.db.prepare(`SELECT u.name AS name, u.denied AS denied, t.text AS command FROM tool_uses u
    LEFT JOIN texts t ON t.key = u.id AND t.kind = 'command'
    WHERE u.denied IS NOT NULL AND u.denied NOT IN ('permission-rule', 'interrupted') AND u.name IS NOT NULL AND u.day BETWEEN $from AND $to`)
    .all(ctx.p) as Row[]
  if (rows.length < 5) return null
  const groups = new Map<string, { label: string; times: number; kinds: Map<string, number> }>()
  let byYou = 0
  let byAuto = 0
  for (const r of rows) {
    const tool = String(r.name)
    const sig = tool === 'Bash' && typeof r.command === 'string' ? commandSignature(r.command) : null
    const label = sig ?? toolLabel(tool)
    const kind = String(r.denied)
    if (kind === 'user-rejected') byYou++
    else byAuto++
    const g = groups.get(label) ?? { label, times: 0, kinds: new Map<string, number>() }
    g.times++
    g.kinds.set(kind, (g.kinds.get(kind) ?? 0) + 1)
    groups.set(label, g)
  }
  const top = [...groups.values()].sort((a, b) => b.times - a.times)
  const { L, count, howOften } = words(ctx.lang)
  const parts = [byYou ? `${count(byYou)} tanesini sen reddettin` : '', byAuto ? `${count(byAuto)} tanesini auto mode engelledi` : ''].filter(Boolean)
  return {
    kind: 'denials',
    title: L('Durdurulan çağrılar', 'Denied tool calls'),
    // At least five calls, so the English is always plural.
    finding: L(
      `${ctx.lead} ${count(rows.length)} araç çağrısı çalışmadan durduruldu: ${parts.join(', ')}.`,
      byAuto === 0
        ? `${ctx.lead}, you rejected ${count(byYou)} tool calls before they ran.`
        : byYou === 0
          ? `${ctx.lead}, auto mode blocked ${count(byAuto)} tool calls before they ran.`
          : `${ctx.lead}, ${count(rows.length)} tool calls were stopped before they ran: you rejected ${count(byYou)} and auto mode blocked ${count(byAuto)}.`,
    ),
    why: L(
      'Her ret Claude\'u durdurur; başka bir yol arar ve fazladan mesaj harcar.',
      'Every denial stops Claude, which then looks for another way and spends extra messages on it.',
    ),
    action: L(
      "Hep reddettiğin bir şeyse Claude'a baştan söyle: CLAUDE.md'ye yaz ya da settings.json'a deny kuralı ekle. Auto mode'un engellediği komutlar gerçekten güvenliyse allow kuralı ekleyebilirsin; emin değilsen engel kalsın.",
      "If it's something you always reject, tell Claude up front: write it in CLAUDE.md or add a deny rule to settings.json. If the commands auto mode blocks are actually safe, you can add an allow rule; if you're not sure, leave the block in place.",
    ),
    saving: null,
    savingKind: null,
    examples: top.slice(0, 6).map((g) => {
      const kinds = [...g.kinds].sort((a, b) => b[1] - a[1]).map(([k]) => DENIAL[k]?.[ctx.lang] ?? k).join(', ')
      return { label: g.label, detail: L(`${count(g.times)} kez · ${kinds}`, `${howOften(g.times)} · ${kinds}`), mono: true }
    }),
    // No ready-made rule here: a deny or allow rule broad enough to match ("Bash(python3:*)") is a
    // decision about what Claude may run, not something to paste without thinking.
    snippet: null,
  }
}

const SETUP: Record<SetupError, { label: (key: string, lang: Lang) => string; line: (keys: string[], lang: Lang) => string }> = {
  'missing-tool': {
    label: (k, lang) => pick(lang, `Bu makinede olmayan program: ${k}`, `Not installed on this machine: ${k}`),
    line: (keys, lang) => {
      const names = keys.map((k) => `\`${k}\``)
      return pick(
        lang,
        `- Bu makinede ${names.join(', ')} kurulu değil; bunlara dayanan komutlar yazma.`,
        keys.length === 1
          ? `- ${names[0]} is not installed on this machine; don't write commands that depend on it.`
          : `- ${andList(names)} are not installed on this machine; don't write commands that depend on them.`,
      )
    },
  },
  'shell-syntax': {
    label: (k, lang) => (k === 'glob' ? pick(lang, "zsh glob'u eşleşmedi", 'zsh glob matched nothing') : pick(lang, 'zsh sözdizimi hatası', 'zsh syntax error')),
    line: (_keys, lang) =>
      pick(
        lang,
        "- Shell zsh: glob içeren argümanları tırnak içine al (ör. --include='*.ts'), bash'e özgü sözdizimi kullanma.",
        "- The shell is zsh: quote arguments that contain globs (e.g. --include='*.ts') and don't use bash-only syntax.",
      ),
  },
  'not-git': {
    label: (_k, lang) => pick(lang, 'Git deposu olmayan klasörde git komutu', 'git command outside a repository'),
    line: (_keys, lang) =>
      pick(
        lang,
        '- Git komutlarından önce doğru klasörde olduğunu kontrol et; worktree yollarını tahmin etme.',
        "- Before running git commands, check that you're in the right directory; don't guess worktree paths.",
      ),
  },
  timeout: {
    label: (_k, lang) => pick(lang, 'Zaman aşımına uğrayan komut', 'Command timed out'),
    line: (_keys, lang) =>
      pick(
        lang,
        '- Uzun süren komutları (build, test, deploy) arka planda çalıştır ve çıktısını sonra oku.',
        '- Run long commands (build, test, deploy) in the background and read their output afterward.',
      ),
  },
}

function setupErrorsTip(ctx: Ctx): Tip | null {
  const rows = ctx.db.prepare(`SELECT u.error AS error FROM tool_uses u
    WHERE u.name = 'Bash' AND u.is_error = 1 AND u.denied IS NULL AND u.error IS NOT NULL AND u.day BETWEEN $from AND $to`).all(ctx.p) as Row[]
  const groups = new Map<string, { kind: SetupError; key: string; times: number; sample: string | null }>()
  for (const r of rows) {
    const c = classifyError(String(r.error))
    if (!c) continue
    const id = `${c.kind}:${c.key}`
    const g = groups.get(id) ?? { kind: c.kind, key: c.key, times: 0, sample: null }
    g.times++
    g.sample ??= c.sample
    groups.set(id, g)
  }
  const found = [...groups.values()].filter((g) => g.times >= (g.kind === 'missing-tool' ? 2 : 3)).sort((a, b) => b.times - a.times)
  if (found.length === 0) return null
  const total = found.reduce((s, g) => s + g.times, 0)
  const kinds = [...new Set(found.map((g) => g.kind))]
  const lines = kinds.map((k) => SETUP[k].line(found.filter((g) => g.kind === k).map((g) => g.key), ctx.lang))
  const { L, count, many, howOften } = words(ctx.lang)
  return {
    kind: 'setup-errors',
    title: L('Ortamdan gelen tekrar eden hatalar', 'Repeated errors from the environment'),
    finding: L(
      `${ctx.lead} ${count(total)} komut, işin kendisiyle değil makineyle ilgili aynı hatalara takıldı.`,
      `${ctx.lead}, ${many(total, 'command')} ran into the same errors, caused by the machine rather than the work itself.`,
    ),
    why: L(
      "Claude bu makinede neyin kurulu olduğunu, shell'in zsh olduğunu bilmez; her oturumda aynı hatayı yapıp düzeltmek token ve zaman harcar.",
      "Claude doesn't know what's installed on this machine or that your shell is zsh. Making the same mistake and correcting it in every session costs tokens and time.",
    ),
    action: L(
      "Doğrusunu CLAUDE.md'ye birer satırla yaz; Claude her oturumda okur. Test hataları gibi işin parçası olan başarısızlıklar burada sayılmaz.",
      "Add a line for each to CLAUDE.md that says what to do instead; Claude reads it in every session. Failures that are part of the work, such as failing tests, aren't counted here.",
    ),
    saving: null,
    savingKind: null,
    examples: found.slice(0, 6).map((g) => ({
      label: SETUP[g.kind].label(g.key, ctx.lang),
      detail: L(`${count(g.times)} kez${g.sample ? ` · ör. ${g.sample}` : ''}`, `${howOften(g.times)}${g.sample ? ` · e.g. ${g.sample}` : ''}`),
    })),
    snippet: { label: '~/.claude/CLAUDE.md', code: `${lines.join('\n')}\n` },
  }
}

function interruptsTip(ctx: Ctx): Tip | null {
  const rows = ctx.db.prepare(`SELECT e.session_id AS id, count(*) AS times,
      (SELECT count(*) FROM prompts p WHERE p.session_id = e.session_id AND p.day BETWEEN $from AND $to) AS prompts,
      (SELECT count(*) FROM tool_uses t WHERE t.session_id = e.session_id AND t.name = 'ExitPlanMode') AS plans
    FROM events e WHERE e.kind = 'interrupt' AND e.day BETWEEN $from AND $to GROUP BY e.session_id ORDER BY times DESC`).all(ctx.p) as Row[]
  const times = rows.reduce((s, r) => s + n(r.times), 0)
  const prompts = n((ctx.db.prepare('SELECT count(*) AS c FROM prompts WHERE day BETWEEN $from AND $to').get(ctx.p) as Row).c)
  if (times < 5 || prompts === 0 || times / prompts < 0.05) return null
  const heavy = rows.filter((r) => n(r.times) >= 5).length
  const planned = rows.some((r) => n(r.plans) > 0)
  const top = rows.slice(0, 5)
  const names = titles(ctx.db, top.map((r) => String(r.id)))
  const { L, count, many, howOften } = words(ctx.lang)
  const every = Math.max(1, Math.round(prompts / times))
  return {
    kind: 'interrupts',
    title: L('Sık interrupt', 'Frequent interrupts'),
    finding: L(
      `${ctx.lead} Claude'u ${count(times)} kez durdurdun, yaklaşık her ${count(every)} prompt'ta bir.${heavy ? ` ${count(heavy)} oturumda 5'ten fazla.` : ''}`,
      `${ctx.lead}, you interrupted Claude ${howOften(times)}, ${every === 1 ? 'about once per prompt' : `about once every ${count(every)} prompts`}.${heavy ? ` In ${many(heavy, 'session')}, it happened more than 5 times.` : ''}`,
    ),
    why: L(
      "Durdurmak çoğu zaman Claude'un yanlış yöne gittiği anlamına gelir; o ana kadar harcanan token'lar boşa gider.",
      'An interrupt usually means Claude was heading in the wrong direction, and the tokens spent up to that point are wasted.',
    ),
    action: planned
      ? L(
          "Büyük işlere plan mode ile başla: Claude önce planını gösterir, onaylamadan dosyaya dokunmaz. İsteği yazarken kapsamı ve bitti sayılma koşulunu da belirt.",
          "Start large tasks in plan mode: Claude shows you its plan first and doesn't touch any files until you approve it. When you write the request, also say what's in scope and what counts as done.",
        )
      : L(
          "Bu oturumların hiçbirinde plan mode kullanılmamış. Büyük işlere plan mode ile başla (Shift+Tab): Claude önce planını gösterir, onaylamadan dosyaya dokunmaz. İsteği yazarken kapsamı ve bitti sayılma koşulunu da belirt.",
          "None of these sessions used plan mode. Start large tasks in plan mode (Shift+Tab): Claude shows you its plan first and doesn't touch any files until you approve it. When you write the request, also say what's in scope and what counts as done.",
        ),
    saving: null,
    savingKind: null,
    examples: top.map((r) => ({
      label: names.get(String(r.id)) ?? String(r.id),
      detail: L(
        `${count(n(r.times))} interrupt · ${count(n(r.prompts))} prompt`,
        `${many(n(r.times), 'interrupt')} · ${many(n(r.prompts), 'prompt')}`,
      ),
      sessionId: String(r.id),
    })),
    snippet: null,
  }
}

function unusedMcpTip(ctx: Ctx): Tip | null {
  const used = new Set((ctx.db.prepare(`SELECT DISTINCT mcp_server AS s FROM tool_uses WHERE mcp_server IS NOT NULL AND day BETWEEN $from AND $to`)
    .all(ctx.p) as Row[]).map((r) => String(r.s)))
  // Only servers the person configured; the desktop app's own and claude.ai's come and go on their own.
  const unused = ctx.env.mcp.filter((m) => (m.scopeKind === 'user' || m.scopeKind === 'project') && !used.has(m.name))
  if (unused.length === 0) return null
  const deferred = n((ctx.db.prepare(`SELECT count(*) AS c FROM tool_uses WHERE name = 'ToolSearch' AND day BETWEEN $from AND $to`).get(ctx.p) as Row).c) > 0
  const { L, count, many } = words(ctx.lang)
  const list = unused.map((m) => m.name).join(', ')
  const mine = unused.filter((m) => m.scopeKind === 'user')
  return {
    kind: 'unused-mcp',
    title: L('Kullanılmayan MCP sunucuları', 'Unused MCP servers'),
    finding: L(
      `${count(unused.length)} MCP sunucusu yapılandırılmış ama ${ctx.inline} hiç çağrılmadı: ${list}.`,
      `${ctx.lead}, ${many(unused.length, 'configured MCP server')} ${unused.length === 1 ? 'was' : 'were'} never called: ${list}.`,
    ),
    why: deferred
      ? L(
          "Her oturum açılışında başlatılırlar. Bu kurulumda araç tanımları gerektiğinde yükleniyor (ToolSearch), yani context'e yükleri küçük; kaldırmak daha çok bir temizlik.",
          "MCP servers start with every session. In this setup, tool definitions load only when they're needed (ToolSearch), so they take up little context; removing them is mostly tidying up.",
        )
      : L(
          'Her oturum açılışında başlatılırlar ve araç tanımları her istekte context\'e eklenebilir.',
          'MCP servers start with every session, and their tool definitions can be added to the context of every request.',
        ),
    action: L(
      "Kendi eklediklerini claude mcp remove ile kaldır. Proje ayarındakiler (.mcp.json) ekiple paylaşılıyor olabilir; onları kaldırmadan önce ekibe sor.",
      'Remove the ones you added yourself with claude mcp remove. Servers in project settings (.mcp.json) may be shared with your team; check with them before you remove those.',
    ),
    saving: null,
    savingKind: null,
    examples: unused.map((m) => ({
      label: m.name,
      detail: `${m.scope}${m.lastUsedAt ? L(' · daha önce kullanılmış', ' · used before') : L(' · hiç kullanılmamış', ' · never used')}`,
      mono: true,
    })),
    snippet: mine.length > 0 ? { label: 'Terminal', code: `${mine.map((m) => `claude mcp remove ${m.name} -s user`).join('\n')}\n` } : null,
  }
}

// Ties among tips without a dollar figure: the ones that cost the most time first.
const FRICTION_ORDER = ['setup-errors', 'interrupts', 'repeated-prompts', 'denials', 'unused-mcp']

export function tipsReport(db: Db, pricing: Pricing, rangeKey: RangeKey = '30d', env?: TipsEnv, lang: Lang = 'tr'): TipsReport {
  const range = rangeBounds(db, rangeKey)
  const { fromMs: _fromMs, ...rangeInfo } = range
  const { lead, inline } = period(rangeKey, lang)
  const ctx: Ctx = {
    db, pricing, lang, key: rangeKey, from: range.from, to: range.to, lead, inline,
    p: { $from: range.from, $to: range.to },
    env: env ?? { instructions: instructionFiles(db, undefined, lang), mcp: mcpServerList(db, lang) },
  }
  const tips = [
    contextTip, cacheRewriteTip, claudeMdTip, lightSessionsTip, subagentModelTip, fastModeTip,
    setupErrorsTip, interruptsTip, repeatedPromptsTip, denialsTip, unusedMcpTip,
  ]
    .map((f) => f(ctx))
    .filter((t): t is Tip => t !== null)
    .sort((a, b) => {
      if (a.saving !== null || b.saving !== null) return (b.saving ?? -1) - (a.saving ?? -1)
      return FRICTION_ORDER.indexOf(a.kind) - FRICTION_ORDER.indexOf(b.kind)
    })
  return { range: rangeInfo, tips }
}

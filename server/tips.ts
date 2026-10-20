// Advice built from the transcripts. Every tip says what was seen, why it matters, what to do
// and which sessions it rests on; a tip shows only when its signal is clear in the range.
import os from 'node:os'
import path from 'node:path'
import type { InstructionFile, McpServer, RangeKey, Tip, TipsReport } from '../shared/types.ts'
import { compactNumber, withPossessive } from '../shared/tr.ts'
import { classifyError, commandSignature, type SetupError } from './commands.ts'
import { PERIOD, money } from './costs.ts'
import type { Db } from './db.ts'
import { instructionFiles, mcpServerList } from './env.ts'
import { type Pricing, normalizeModel } from './pricing.ts'
import { rangeBounds } from './range.ts'

type Row = Record<string, unknown>
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const int = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 })
const count = (v: number) => int.format(Math.round(v))

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
  return {
    kind: 'context',
    title: 'Context şişmesi',
    finding: `${ctx.lead} maliyetin ${withPossessive((big / total) * 100, '%')} (${money(big)}) context'i 200 bin token'ı aşan ${count(calls)} çağrıdan geldi. En büyük context ${compactNumber(peak)} token'a ulaştı.`,
    why: "Claude her istekte konuşmanın tamamını cache'ten yeniden okur. Context büyüdükçe her mesaj, istenen iş ne kadar küçük olursa olsun, pahalılaşır.",
    action: "Konu değişince yeni oturum aç. Uzun bir işin ortasındaysan context 150 bin token civarına geldiğinde /compact ile konuşmayı özetle.",
    saving,
    savingKind: 'upTo',
    examples: top.map(([id, e]) => ({ label: names.get(id) ?? id, detail: `${money(e.cost)} · en büyük context ${compactNumber(e.peak)} token`, sessionId: id })),
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
  return {
    kind: 'cache-rewrite',
    title: "Aradan sonra yeniden yazılan cache",
    finding: `${ctx.lead} konuşma ${count(times)} kez 5 dakikadan uzun bir aradan sonra devam etti ve context'in tamamı cache'e yeniden yazıldı. Bu yazmalar ${money(cost)} tuttu.`,
    why: "Cache 5 dakika ya da 1 saat kullanılmayınca düşer. Aradan sonraki ilk mesaj bütün konuşmayı yeniden yazar ve cache'e yazmak, okumaktan kat kat pahalıdır.",
    action: "Uzun bir aradan sonra başka bir işe geçeceksen yeni oturum aç. Aynı işe döneceksen ara vermeden önce /compact yap; yeniden yazılan context küçük olur.",
    saving,
    savingKind: 'about',
    examples: top.map(([id, e]) => ({ label: names.get(id) ?? id, detail: `${count(e.times)} kez · ${money(e.cost)}`, sessionId: id })),
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
    const user = f.scope === 'Kullanıcı'
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
  return {
    kind: 'claude-md',
    title: 'Uzun CLAUDE.md',
    finding: `${first.file} yaklaşık ${compactNumber(first.tokens)} token. ${ctx.lead} ${count(first.calls)} istekte her seferinde okundu ve yaklaşık ${money(first.cost)} tuttu.`,
    why: 'CLAUDE.md her isteğin başına eklenir. Uzun bir dosya her mesajda yeniden okunur ve dikkat edilmesi gereken kuralları da sulandırır.',
    action: "Her oturumda gereken kuralları kısa tut. Uzun belgeleri ayrı dosyalara taşı ve CLAUDE.md'de yalnızca adlarını an; Claude gerektiğinde okur.",
    saving: found.reduce((s, f) => s + f.saving, 0),
    savingKind: 'upTo',
    examples: found.slice(0, 5).map((f) => ({ label: f.file, detail: `${compactNumber(f.tokens)} token · ${count(f.calls)} istek · ${money(f.cost)}`, mono: true })),
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
  return {
    kind: 'light-sessions',
    title: 'Hafif işler için büyük model',
    finding: `${ctx.lead} ${count(bySession.size)} oturum neredeyse hiç araç kullanmadan, soru-cevap gibi geçti ve büyük modelle ${money(cost)} tuttu. Aynı token'lar ${CHEAPER_NAME} ile yaklaşık ${money(alt)} olurdu.`,
    why: `Kod yazmayan, dosya okumayan kısa işlerde ${CHEAPER_NAME} çoğu zaman yeterli ve daha ucuz.`,
    action: `Böyle işlere /model ile ${CHEAPER_NAME}'e geçerek başla. Soru zorsa büyük modelde kal; bu ipucu yalnızca kullanım şekline bakıyor, sorunun zorluğunu bilemez.`,
    saving: cost - alt,
    savingKind: 'about',
    examples: top.map(([id, e]) => ({ label: names.get(id) ?? id, detail: `${money(e.cost)} · ${CHEAPER_NAME} ile ${money(e.alt)}`, sessionId: id })),
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
  return {
    kind: 'subagent-model',
    title: "Subagent'lar için model",
    finding: `Subagent çağrıları ${ctx.inline} büyük modelle ${money(cost)} tuttu. ${CHEAPER_NAME} ile yaklaşık ${money(alt)} olurdu.`,
    why: `Arama, keşif ve özetleme gibi subagent işlerinde ${CHEAPER_NAME} genellikle yeterli.`,
    action: "Kendi subagent tanımlarına model: sonnet ekle. Ağır iş yapan subagent'ları büyük modelde bırak.",
    saving: cost - alt,
    savingKind: 'about',
    examples: types.map((r) => ({ label: String(r.name), detail: `${count(n(r.calls))} çağrı`, mono: true })),
    snippet: { label: '.claude/agents/arastirmaci.md', code: '---\nname: arastirmaci\ndescription: Kod tabanında arama ve keşif\nmodel: sonnet\n---\n' },
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
  return {
    kind: 'fast-mode',
    title: 'Fast mode farkı',
    finding: `Fast mode ${ctx.inline} ${count(calls)} istekte ${money(extra)} fazladan tuttu.`,
    why: 'Fast mode aynı modeli daha hızlı çalıştırır ama fiyatı katlar.',
    action: 'Beklemenin sorun olmadığı işlerde /fast ile kapat; hızın gerçekten önemli olduğu anlara sakla.',
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
const slug = (normalized: string) =>
  normalized.split(' ').slice(0, 3).join('-').replace(/[çğıöşü]/g, (c) => ASCII[c] ?? c).replace(/[^a-z0-9-]/g, '') || 'komut'

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
  return {
    kind: 'repeated-prompts',
    title: "Tekrar tekrar yazdığın prompt'lar",
    finding: `${count(repeated.length)} prompt'u birden fazla oturumda aynen yeniden yazmışsın. En sık olanı ${count(first.times)} kez, ${count(first.sessions.size)} oturumda.`,
    why: "Her seferinde yazmak zaman alır ve küçük ifade farkları Claude'un davranışını değiştirir.",
    action: "Bunları slash komutu yap: ~/.claude/commands/ klasörüne bir .md dosyası koyunca /dosya-adı ile çağrılır. Her oturumda geçerli olması gereken bir kuralsa CLAUDE.md'ye yaz.",
    saving: null,
    savingKind: null,
    examples: repeated.slice(0, 5).map(([, g]) => ({ label: clip(g.text, 160), detail: `${count(g.times)} kez · ${count(g.sessions.size)} oturum` })),
    snippet: { label: `~/.claude/commands/${slug(firstKey)}.md`, code: `${first.text.replace(/…$/, '')}\n` },
  }
}

const DENIAL: Record<string, string> = {
  'user-rejected': 'sen reddettin',
  'automode-blocked': 'auto mode engelledi',
  'automode-unavailable': 'auto mode kapalıydı',
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
  const parts = [byYou ? `${count(byYou)} tanesini sen reddettin` : '', byAuto ? `${count(byAuto)} tanesini auto mode engelledi` : ''].filter(Boolean)
  return {
    kind: 'denials',
    title: 'Durdurulan çağrılar',
    finding: `${ctx.lead} ${count(rows.length)} araç çağrısı çalışmadan durduruldu: ${parts.join(', ')}.`,
    why: 'Her ret Claude\'u durdurur; başka bir yol arar ve fazladan mesaj harcar.',
    action:
      "Hep reddettiğin bir şeyse Claude'a baştan söyle: CLAUDE.md'ye yaz ya da settings.json'a deny kuralı ekle. Auto mode'un engellediği komutlar gerçekten güvenliyse allow kuralı ekleyebilirsin; emin değilsen engel kalsın.",
    saving: null,
    savingKind: null,
    examples: top.slice(0, 6).map((g) => ({
      label: g.label,
      detail: `${count(g.times)} kez · ${[...g.kinds].sort((a, b) => b[1] - a[1]).map(([k]) => DENIAL[k] ?? k).join(', ')}`,
      mono: true,
    })),
    // No ready-made rule here: a deny or allow rule broad enough to match ("Bash(python3:*)") is a
    // decision about what Claude may run, not something to paste without thinking.
    snippet: null,
  }
}

const SETUP: Record<SetupError, { label: (key: string) => string; line: (keys: string[]) => string }> = {
  'missing-tool': {
    label: (k) => `Bu makinede olmayan program: ${k}`,
    line: (keys) => `- Bu makinede ${keys.map((k) => `\`${k}\``).join(', ')} kurulu değil; bunlara dayanan komutlar yazma.`,
  },
  'shell-syntax': {
    label: (k) => (k === 'glob' ? "zsh glob'u eşleşmedi" : 'zsh sözdizimi hatası'),
    line: () => "- Shell zsh: glob içeren argümanları tırnak içine al (ör. --include='*.ts'), bash'e özgü sözdizimi kullanma.",
  },
  'not-git': {
    label: () => 'Git deposu olmayan klasörde git komutu',
    line: () => '- Git komutlarından önce doğru klasörde olduğunu kontrol et; worktree yollarını tahmin etme.',
  },
  timeout: {
    label: () => 'Zaman aşımına uğrayan komut',
    line: () => '- Uzun süren komutları (build, test, deploy) arka planda çalıştır ve çıktısını sonra oku.',
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
  const lines = kinds.map((k) => SETUP[k].line(found.filter((g) => g.kind === k).map((g) => g.key)))
  return {
    kind: 'setup-errors',
    title: 'Ortamdan gelen tekrar eden hatalar',
    finding: `${ctx.lead} ${count(total)} komut, işin kendisiyle değil makineyle ilgili aynı hatalara takıldı.`,
    why: "Claude bu makinede neyin kurulu olduğunu, shell'in zsh olduğunu bilmez; her oturumda aynı hatayı yapıp düzeltmek token ve zaman harcar.",
    action: "Doğrusunu CLAUDE.md'ye birer satırla yaz; Claude her oturumda okur. Test hataları gibi işin parçası olan başarısızlıklar burada sayılmaz.",
    saving: null,
    savingKind: null,
    examples: found.slice(0, 6).map((g) => ({ label: SETUP[g.kind].label(g.key), detail: `${count(g.times)} kez${g.sample ? ` · ör. ${g.sample}` : ''}` })),
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
  return {
    kind: 'interrupts',
    title: 'Sık interrupt',
    finding: `${ctx.lead} Claude'u ${count(times)} kez durdurdun, yaklaşık her ${count(Math.max(1, Math.round(prompts / times)))} prompt'ta bir.${heavy ? ` ${count(heavy)} oturumda 5'ten fazla.` : ''}`,
    why: "Durdurmak çoğu zaman Claude'un yanlış yöne gittiği anlamına gelir; o ana kadar harcanan token'lar boşa gider.",
    action: planned
      ? "Büyük işlere plan mode ile başla: Claude önce planını gösterir, onaylamadan dosyaya dokunmaz. İsteği yazarken kapsamı ve bitti sayılma koşulunu da belirt."
      : "Bu oturumların hiçbirinde plan mode kullanılmamış. Büyük işlere plan mode ile başla (Shift+Tab): Claude önce planını gösterir, onaylamadan dosyaya dokunmaz. İsteği yazarken kapsamı ve bitti sayılma koşulunu da belirt.",
    saving: null,
    savingKind: null,
    examples: top.map((r) => ({
      label: names.get(String(r.id)) ?? String(r.id),
      detail: `${count(n(r.times))} interrupt · ${count(n(r.prompts))} prompt`,
      sessionId: String(r.id),
    })),
    snippet: null,
  }
}

function unusedMcpTip(ctx: Ctx): Tip | null {
  const used = new Set((ctx.db.prepare(`SELECT DISTINCT mcp_server AS s FROM tool_uses WHERE mcp_server IS NOT NULL AND day BETWEEN $from AND $to`)
    .all(ctx.p) as Row[]).map((r) => String(r.s)))
  // Only servers the person configured; the desktop app's own and claude.ai's come and go on their own.
  const unused = ctx.env.mcp.filter((m) => (m.scope === 'Kullanıcı' || m.scope.startsWith('Proje')) && !used.has(m.name))
  if (unused.length === 0) return null
  const deferred = n((ctx.db.prepare(`SELECT count(*) AS c FROM tool_uses WHERE name = 'ToolSearch' AND day BETWEEN $from AND $to`).get(ctx.p) as Row).c) > 0
  return {
    kind: 'unused-mcp',
    title: 'Kullanılmayan MCP sunucuları',
    finding: `${count(unused.length)} MCP sunucusu yapılandırılmış ama ${ctx.inline} hiç çağrılmadı: ${unused.map((m) => m.name).join(', ')}.`,
    why: deferred
      ? "Her oturum açılışında başlatılırlar. Bu kurulumda araç tanımları gerektiğinde yükleniyor (ToolSearch), yani context'e yükleri küçük; kaldırmak daha çok bir temizlik."
      : 'Her oturum açılışında başlatılırlar ve araç tanımları her istekte context\'e eklenebilir.',
    action: "Kendi eklediklerini claude mcp remove ile kaldır. Proje ayarındakiler (.mcp.json) ekiple paylaşılıyor olabilir; onları kaldırmadan önce ekibe sor.",
    saving: null,
    savingKind: null,
    examples: unused.map((m) => ({
      label: m.name,
      detail: `${m.scope}${m.lastUsedAt ? ' · daha önce kullanılmış' : ' · hiç kullanılmamış'}`,
      mono: true,
    })),
    snippet: unused.some((m) => m.scope === 'Kullanıcı')
      ? { label: 'Terminal', code: `${unused.filter((m) => m.scope === 'Kullanıcı').map((m) => `claude mcp remove ${m.name} -s user`).join('\n')}\n` }
      : null,
  }
}

// Ties among tips without a dollar figure: the ones that cost the most time first.
const FRICTION_ORDER = ['setup-errors', 'interrupts', 'repeated-prompts', 'denials', 'unused-mcp']

export function tipsReport(db: Db, pricing: Pricing, rangeKey: RangeKey = '30d', env?: TipsEnv): TipsReport {
  const range = rangeBounds(db, rangeKey)
  const { fromMs: _fromMs, ...rangeInfo } = range
  const ctx: Ctx = {
    db, pricing, key: rangeKey, from: range.from, to: range.to,
    lead: PERIOD[rangeKey].lead, inline: PERIOD[rangeKey].inline,
    p: { $from: range.from, $to: range.to },
    env: env ?? { instructions: instructionFiles(db), mcp: mcpServerList(db) },
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


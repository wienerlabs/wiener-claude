import fs from 'node:fs/promises'
import { type Lang, formatInt, pick } from '../shared/i18n.ts'
import type { ReplayItem, ReplayTurn } from '../shared/types.ts'
import type { Db } from './db.ts'
import { readLinesFrom } from './jsonl.ts'
import { HISTORY_KEY, cleanPrompt, isHumanPrompt, parseTs, promptKind, userText } from './parse.ts'
import type { Pricing, Usage } from './pricing.ts'

type Json = Record<string, unknown>
const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

const MAX_TOOL_TEXT = 1500
const MAX_TEXT = 30_000

function clip(text: string, max: number, lang: Lang): string {
  if (text.length <= max) return text
  const more = formatInt(text.length - max, lang)
  return `${text.slice(0, max)}\n… ${pick(lang, `(${more} karakter daha)`, `(${more} more characters)`)}`
}

function shortPath(p: string, cwd: string | null): string {
  if (cwd && p.startsWith(`${cwd}/`)) return p.slice(cwd.length + 1)
  return p.replace(/^\/Users\/[^/]+\//, '~/')
}

/** One line that says what a tool call did: the command, the file, the query. */
export function toolSummary(name: string, input: Json | null, cwd: string | null, lang: Lang = 'tr'): string {
  const i = input ?? {}
  const s = (k: string) => str(i[k])
  const firstLine = (t: string) => t.split('\n')[0]?.slice(0, 200) ?? ''
  switch (name) {
    case 'Bash':
      return firstLine(s('command') ?? '')
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return shortPath(s('file_path') ?? s('notebook_path') ?? '', cwd)
    case 'Grep':
      return [s('pattern'), s('path') ? `· ${shortPath(s('path') as string, cwd)}` : null].filter(Boolean).join(' ')
    case 'Glob':
      return s('pattern') ?? ''
    case 'WebFetch':
      return s('url') ?? ''
    case 'WebSearch':
      return s('query') ?? ''
    case 'Task':
    case 'Agent':
      return s('description') ?? firstLine(s('prompt') ?? '')
    case 'TodoWrite':
      return Array.isArray(i.todos) ? pick(lang, `${i.todos.length} görev`, `${i.todos.length} ${i.todos.length === 1 ? 'task' : 'tasks'}`) : ''
    case 'Skill':
      return s('skill') ?? s('command') ?? ''
  }
  const firstString = Object.values(i).find((v): v is string => typeof v === 'string')
  return firstString ? firstLine(firstString) : ''
}

function resultText(content: unknown, lang: Lang): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((b) => {
      const block = obj(b)
      if (block?.type === 'text') return str(block.text) ?? ''
      if (block?.type === 'image') return pick(lang, '[görsel]', '[image]')
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

interface Building extends ReplayTurn {
  usage: Map<string, { model: string; u: Usage }>
}

/**
 * Groups a transcript into turns: one per prompt, holding everything Claude did until the next.
 * Records are fed one at a time so a large transcript never sits in memory whole.
 */
export interface BuiltTurns {
  turns: ReplayTurn[]
  /** Record uuid or tool id -> index of the turn it belongs to; used to open search hits. */
  keyIndex: Map<string, number>
}

type PromptKindOfTurn = NonNullable<ReplayTurn['prompt']>['kind']

export function historyTurns(db: Db, sessionId: string, lang: Lang): BuiltTurns {
  const rows = db
    .prepare(`SELECT p.uuid, p.ts, p.kind, COALESCE(t.text, p.preview) AS text FROM prompts p LEFT JOIN texts t ON t.key = p.uuid
      WHERE p.session_id = ? AND p.uuid LIKE '${HISTORY_KEY}%' ORDER BY p.ts`)
    .all(sessionId) as { uuid: string; ts: number; kind: PromptKindOfTurn; text: string }[]
  const turns = rows.map((r, index): ReplayTurn => ({
    index, ts: r.ts, prompt: { text: clip(r.text, MAX_TEXT, lang), kind: r.kind, images: 0, key: r.uuid },
    items: [], cost: 0, outputTokens: 0, toolCalls: 0, errors: 0,
  }))
  return { turns, keyIndex: new Map(rows.map((r, index) => [r.uuid, index])) }
}

export function turnBuilder(pricing: Pricing, lang: Lang = 'tr'): { add: (o: Json) => void; finish: () => BuiltTurns } {
  const turns: Building[] = []
  const keyIndex = new Map<string, number>()
  const tools = new Map<string, Extract<ReplayItem, { type: 'tool' }>>()
  let cwd: string | null = null
  let current: Building | null = null

  const ensure = (ts: number): Building => {
    if (!current) {
      current = { index: turns.length, ts, prompt: null, items: [], cost: 0, outputTokens: 0, toolCalls: 0, errors: 0, usage: new Map() }
      turns.push(current)
    }
    return current
  }

  const add = (o: Json): void => {
    place(o)
    const uuid = str(o.uuid)
    if (uuid && current) keyIndex.set(uuid, current.index)
  }

  const place = (o: Json): void => {
    const ts = parseTs(o.timestamp) ?? 0
    cwd = str(o.cwd) ?? cwd
    const m = obj(o.message)

    if (o.type === 'user' && m) {
      const { text, images, toolResults } = userText(m.content)
      for (const r of toolResults) {
        const item = tools.get(str(r.tool_use_id) ?? '')
        if (!item) continue
        const isError = r.is_error === true
        const denied = str(o.toolDenialKind)
        item.result = { text: clip(resultText(r.content, lang), MAX_TOOL_TEXT, lang), isError, denied, ts }
        if (isError && !denied && current) current.errors++
      }
      if (toolResults.length > 0 || o.isMeta || o.isCompactSummary) return
      const trimmed = text.trimStart()
      if (trimmed.startsWith('[Request interrupted')) {
        ensure(ts).items.push({ type: 'notice', ts, tone: 'neutral', text: pick(lang, 'Kullanıcı yanıtı yarıda kesti.', 'You interrupted the response.') })
      } else if (isHumanPrompt(o, text)) {
        current = {
          index: turns.length, ts,
          prompt: { text: clip(cleanPrompt(text), MAX_TEXT, lang), kind: promptKind(text), images, key: str(o.uuid) ?? '' },
          items: [], cost: 0, outputTokens: 0, toolCalls: 0, errors: 0, usage: new Map(),
        }
        turns.push(current)
      } else {
        const kind = obj(o.origin)?.kind
        if (kind === 'task-notification' || trimmed.startsWith('<task-notification')) {
          ensure(ts).items.push({ type: 'notice', ts, tone: 'neutral', text: pick(lang, 'Arka plandaki bir görevden bildirim geldi.', 'A background task sent a notification.') })
        } else if (kind === 'peer') {
          ensure(ts).items.push({ type: 'notice', ts, tone: 'neutral', text: pick(lang, 'Başka bir oturumdan mesaj geldi.', 'A message came in from another session.') })
        }
      }
      return
    }

    if (o.type === 'assistant' && m) {
      const turn = ensure(ts)
      if (o.isApiErrorMessage) {
        const text = Array.isArray(m.content) ? resultText(m.content, lang) : ''
        turn.items.push({ type: 'notice', ts, tone: 'error', text: text || pick(lang, 'API hatası', 'API error') })
        turn.errors++
        return
      }
      const model = str(m.model)
      const usage = obj(m.usage)
      const msgId = str(m.id)
      if (model && model !== '<synthetic>' && usage && msgId) {
        const cc = obj(usage.cache_creation)
        const u: Usage = {
          input: num(usage.input_tokens),
          output: num(usage.output_tokens),
          cacheRead: num(usage.cache_read_input_tokens),
          cacheWrite5m: num(cc?.ephemeral_5m_input_tokens),
          cacheWrite1h: num(cc?.ephemeral_1h_input_tokens),
          webSearch: num(obj(usage.server_tool_use)?.web_search_requests),
          fast: usage.speed === 'fast',
        }
        const rest = num(usage.cache_creation_input_tokens) - u.cacheWrite5m - u.cacheWrite1h
        if (rest > 0) u.cacheWrite5m += rest
        const prev = turn.usage.get(msgId)?.u
        turn.usage.set(msgId, {
          model,
          u: prev
            ? {
                input: Math.max(prev.input, u.input), output: Math.max(prev.output, u.output),
                cacheRead: Math.max(prev.cacheRead, u.cacheRead), cacheWrite5m: Math.max(prev.cacheWrite5m, u.cacheWrite5m),
                cacheWrite1h: Math.max(prev.cacheWrite1h, u.cacheWrite1h), webSearch: Math.max(prev.webSearch, u.webSearch),
                fast: prev.fast || u.fast,
              }
            : u,
        })
      }
      const blocks: unknown[] = Array.isArray(m.content) ? m.content : []
      for (const [i, b] of blocks.entries()) {
        const block = obj(b)
        if (!block) continue
        if (block.type === 'text') {
          const text = str(block.text)?.trim()
          // Same key the search index uses for this block.
          if (text) turn.items.push({ type: 'text', ts, text: clip(text, MAX_TEXT, lang), key: `${str(o.uuid) ?? ''}:${i}` })
        } else if (block.type === 'thinking') {
          const text = str(block.thinking)?.trim()
          if (text) turn.items.push({ type: 'thinking', ts, text: clip(text, MAX_TEXT, lang), durationMs: num(o.thinkingDurationMs) || null })
        } else if (block.type === 'tool_use') {
          const id = str(block.id)
          const name = str(block.name)
          if (!id || !name) continue
          const input = obj(block.input)
          const item: Extract<ReplayItem, { type: 'tool' }> = {
            type: 'tool', id, name, ts,
            summary: toolSummary(name, input, cwd, lang),
            input: clip(JSON.stringify(input ?? {}, null, 2), MAX_TOOL_TEXT, lang),
            result: null,
          }
          tools.set(id, item)
          keyIndex.set(id, turn.index)
          turn.items.push(item)
          turn.toolCalls++
        }
      }
      return
    }

    if (o.type === 'system' && o.subtype === 'compact_boundary') {
      const meta = obj(o.compactMetadata)
      ensure(ts).items.push({
        type: 'compact', ts,
        trigger: str(meta?.trigger),
        preTokens: typeof meta?.preTokens === 'number' ? meta.preTokens : null,
      })
    }
  }

  const finish = (): BuiltTurns => ({
    keyIndex,
    turns: turns.map(({ usage, ...turn }) => {
      let cost = 0
      let outputTokens = 0
      for (const { model, u } of usage.values()) {
        cost += pricing.cost(model, u) ?? 0
        outputTokens += u.output
      }
      return { ...turn, cost, outputTokens }
    }),
  })

  return { add, finish }
}

export function buildTurns(records: Json[], pricing: Pricing, lang: Lang = 'tr'): ReplayTurn[] {
  const b = turnBuilder(pricing, lang)
  for (const o of records) b.add(o)
  return b.finish().turns
}

const cache = new Map<string, BuiltTurns>()
const CACHE_SIZE = 3

/** Turns of a transcript file, cached by path, size, modification time and language. */
export async function turnsOf(file: string, pricing: Pricing, lang: Lang = 'tr'): Promise<BuiltTurns> {
  const st = await fs.stat(file)
  const key = `${file}:${st.size}:${st.mtimeMs}:${pricing.version}:${lang}`
  const hit = cache.get(key)
  if (hit) {
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  const builder = turnBuilder(pricing, lang)
  await readLinesFrom(file, 0, (line) => {
    try {
      const o = JSON.parse(line) as unknown
      if (o && typeof o === 'object' && !Array.isArray(o)) builder.add(o as Json)
    } catch {
      // Skip a malformed line.
    }
  })
  const built = builder.finish()
  for (const k of cache.keys()) if (k.startsWith(`${file}:`) && !k.startsWith(`${file}:${st.size}:${st.mtimeMs}:`)) cache.delete(k)
  cache.set(key, built)
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string)
  return built
}

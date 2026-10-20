import fs from 'node:fs/promises'
import type { ReplayItem, ReplayTurn } from '../shared/types.ts'
import { readLinesFrom } from './jsonl.ts'
import { cleanPrompt, isHumanPrompt, parseTs, promptKind, userText } from './parse.ts'
import type { Pricing, Usage } from './pricing.ts'

type Json = Record<string, unknown>
const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

const MAX_TOOL_TEXT = 1500
const MAX_TEXT = 30_000

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n… (${(text.length - max).toLocaleString('tr-TR')} karakter daha)` : text
}

function shortPath(p: string, cwd: string | null): string {
  if (cwd && p.startsWith(`${cwd}/`)) return p.slice(cwd.length + 1)
  return p.replace(/^\/Users\/[^/]+\//, '~/')
}

/** One line that says what a tool call did: the command, the file, the query. */
export function toolSummary(name: string, input: Json | null, cwd: string | null): string {
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
      return Array.isArray(i.todos) ? `${i.todos.length} görev` : ''
    case 'Skill':
      return s('skill') ?? s('command') ?? ''
  }
  const firstString = Object.values(i).find((v): v is string => typeof v === 'string')
  return firstString ? firstLine(firstString) : ''
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((b) => {
      const block = obj(b)
      if (block?.type === 'text') return str(block.text) ?? ''
      if (block?.type === 'image') return '[görsel]'
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
export function turnBuilder(pricing: Pricing): { add: (o: Json) => void; finish: () => ReplayTurn[] } {
  const turns: Building[] = []
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
        item.result = { text: clip(resultText(r.content), MAX_TOOL_TEXT), isError, denied, ts }
        if (isError && !denied && current) current.errors++
      }
      if (toolResults.length > 0 || o.isMeta || o.isCompactSummary) return
      const trimmed = text.trimStart()
      if (trimmed.startsWith('[Request interrupted')) {
        ensure(ts).items.push({ type: 'notice', ts, tone: 'neutral', text: 'Kullanıcı yanıtı yarıda kesti.' })
      } else if (isHumanPrompt(o, text)) {
        current = {
          index: turns.length, ts,
          prompt: { text: clip(cleanPrompt(text), MAX_TEXT), kind: promptKind(text), images },
          items: [], cost: 0, outputTokens: 0, toolCalls: 0, errors: 0, usage: new Map(),
        }
        turns.push(current)
      } else {
        const kind = obj(o.origin)?.kind
        if (kind === 'task-notification' || trimmed.startsWith('<task-notification')) {
          ensure(ts).items.push({ type: 'notice', ts, tone: 'neutral', text: 'Arka plandaki bir görevden bildirim geldi.' })
        } else if (kind === 'peer') {
          ensure(ts).items.push({ type: 'notice', ts, tone: 'neutral', text: 'Başka bir oturumdan mesaj geldi.' })
        }
      }
      return
    }

    if (o.type === 'assistant' && m) {
      const turn = ensure(ts)
      if (o.isApiErrorMessage) {
        const text = Array.isArray(m.content) ? resultText(m.content) : ''
        turn.items.push({ type: 'notice', ts, tone: 'error', text: text || 'API hatası' })
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
      for (const b of Array.isArray(m.content) ? m.content : []) {
        const block = obj(b)
        if (!block) continue
        if (block.type === 'text') {
          const text = str(block.text)?.trim()
          if (text) turn.items.push({ type: 'text', ts, text: clip(text, MAX_TEXT) })
        } else if (block.type === 'thinking') {
          const text = str(block.thinking)?.trim()
          if (text) turn.items.push({ type: 'thinking', ts, text: clip(text, MAX_TEXT), durationMs: num(o.thinkingDurationMs) || null })
        } else if (block.type === 'tool_use') {
          const id = str(block.id)
          const name = str(block.name)
          if (!id || !name) continue
          const input = obj(block.input)
          const item: Extract<ReplayItem, { type: 'tool' }> = {
            type: 'tool', id, name, ts,
            summary: toolSummary(name, input, cwd),
            input: clip(JSON.stringify(input ?? {}, null, 2), MAX_TOOL_TEXT),
            result: null,
          }
          tools.set(id, item)
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

  const finish = (): ReplayTurn[] =>
    turns.map(({ usage, ...turn }) => {
      let cost = 0
      let outputTokens = 0
      for (const { model, u } of usage.values()) {
        cost += pricing.cost(model, u) ?? 0
        outputTokens += u.output
      }
      return { ...turn, cost, outputTokens }
    })

  return { add, finish }
}

export function buildTurns(records: Json[], pricing: Pricing): ReplayTurn[] {
  const b = turnBuilder(pricing)
  for (const o of records) b.add(o)
  return b.finish()
}

const cache = new Map<string, ReplayTurn[]>()
const CACHE_SIZE = 3

/** Turns of a transcript file, cached by path, size and modification time. */
export async function turnsOf(file: string, pricing: Pricing): Promise<ReplayTurn[]> {
  const st = await fs.stat(file)
  const key = `${file}:${st.size}:${st.mtimeMs}:${pricing.version}`
  const hit = cache.get(key)
  if (hit) {
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  const builder = turnBuilder(pricing)
  await readLinesFrom(file, 0, (line) => {
    try {
      const o = JSON.parse(line) as unknown
      if (o && typeof o === 'object' && !Array.isArray(o)) builder.add(o as Json)
    } catch {
      // Skip a malformed line.
    }
  })
  const turns = builder.finish()
  for (const k of cache.keys()) if (k.startsWith(`${file}:`)) cache.delete(k)
  cache.set(key, turns)
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string)
  return turns
}

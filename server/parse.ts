// Turns one Claude Code JSONL record into facts. Pure: no I/O, no database.

export interface LineContext {
  /** Session the file belongs to: the file name for main files, the parent folder for subagent files. */
  fileSessionId: string
  isSubagent: boolean
}

export interface SessionFact {
  kind: 'session'
  sessionId: string
  ts: number
  cwd: string | null
  gitBranch: string | null
  version: string | null
  entrypoint: string | null
}

export interface ApiFact {
  kind: 'api'
  msgId: string
  sessionId: string
  ts: number
  model: string
  input: number
  output: number
  cacheRead: number
  cacheWrite5m: number
  cacheWrite1h: number
  webSearch: number
  fast: boolean
  sidechain: boolean
}

export type PromptKind = 'prompt' | 'command' | 'bash'

export type Fact =
  | SessionFact
  | ApiFact
  | { kind: 'prompt'; uuid: string; sessionId: string; ts: number; promptKind: PromptKind; preview: string }
  | { kind: 'tool_use'; id: string; sessionId: string; ts: number; name: string; mcpServer: string | null; sidechain: boolean }
  | { kind: 'tool_result'; id: string; sessionId: string; ts: number; isError: boolean; denied: string | null }
  | { kind: 'event'; uuid: string; sessionId: string; ts: number; eventKind: EventKind }
  | {
      kind: 'cost'
      sessionId: string
      startTime: number
      totalCost: number
      linesAdded: number
      linesRemoved: number
      apiMs: number
      toolMs: number
      durationMs: number
    }
  | { kind: 'title'; sessionId: string; source: 'custom' | 'ai'; title: string }
  | { kind: 'pr'; sessionId: string; url: string; number: number | null; repo: string | null; ts: number }

/** api_error: an error shown to the user. api_retry: a retried request. */
export type EventKind = 'api_error' | 'api_retry' | 'compact' | 'interrupt'

type Json = Record<string, unknown>

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)
const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null)

export function parseTs(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : t
}

/** Plain text of a user message, plus how many images it carried. */
export function userText(content: unknown): { text: string; images: number; toolResults: Json[] } {
  if (typeof content === 'string') return { text: content, images: 0, toolResults: [] }
  if (!Array.isArray(content)) return { text: '', images: 0, toolResults: [] }
  const parts: string[] = []
  const toolResults: Json[] = []
  let images = 0
  for (const b of content) {
    const block = obj(b)
    if (!block) continue
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    else if (block.type === 'image') images++
    else if (block.type === 'tool_result') toolResults.push(block)
  }
  return { text: parts.join('\n'), images, toolResults }
}

// Text that Claude Code injects as a "user" message without the person typing it.
const INJECTED_PREFIXES = [
  '<task-notification',
  '<local-command-caveat',
  '<local-command-stdout',
  '<local-command-stderr',
  '<system-reminder',
  '<bash-stdout',
  '<bash-stderr',
  '<artifact-content',
  '[Request interrupted',
  'Caveat: The messages below',
]

/**
 * Whether a user record is something the person typed. Newer records say so in origin.kind
 * or turnOrigin; older ones only reveal it through the wrapper tags in the text.
 */
export function isHumanPrompt(o: Json, text: string): boolean {
  if (o.isMeta || o.isCompactSummary || o.isVisibleInTranscriptOnly || o.isSidechain) return false
  const kind = obj(o.origin)?.kind
  if (typeof kind === 'string') return kind === 'human'
  if (typeof o.turnOrigin === 'string') return o.turnOrigin === 'human'
  const t = text.trimStart()
  if (!t) return false
  return !INJECTED_PREFIXES.some((p) => t.startsWith(p))
}

export function promptKind(text: string): PromptKind {
  const t = text.trimStart()
  if (t.startsWith('<command-name>')) return 'command'
  if (t.startsWith('<bash-input>')) return 'bash'
  return 'prompt'
}

const tag = (name: string) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)

/** Readable form of a prompt: wrapper tags removed, slash commands and shell input spelled out. */
export function cleanPrompt(text: string): string {
  let t = text
  t = t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
  t = t.replace(/<!--\s*attach:[\s\S]*?-->/g, '')
  const cmd = t.match(tag('command-name'))
  if (cmd) {
    const args = t.match(tag('command-args'))?.[1]?.trim()
    return [cmd[1]?.trim(), args].filter(Boolean).join(' ')
  }
  const bash = t.match(tag('bash-input'))
  if (bash) return `! ${bash[1]?.trim() ?? ''}`
  t = t.replace(/<pasted_content[^>]*>([\s\S]*?)<\/pasted_content>/g, (_m, inner: string) => inner)
  return t.trim()
}

export function previewOf(text: string, max = 280): string {
  const oneLine = cleanPrompt(text)
    .replace(/<pasted_content[^>]*>[\s\S]*?<\/pasted_content>/g, '[yapıştırılan metin]')
    .replace(/\s+/g, ' ')
    .trim()
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine
}

function mcpServerOf(name: string): string | null {
  if (!name.startsWith('mcp__')) return null
  return name.split('__')[1] || null
}

export function parseLine(o: Json, ctx: LineContext): Fact[] {
  const type = o.type
  const ts = parseTs(o.timestamp)
  // Subagent records belong to the session that spawned them, whatever id they carry.
  const sessionId = ctx.isSubagent ? ctx.fileSessionId : str(o.sessionId) ?? ctx.fileSessionId
  const sidechain = ctx.isSubagent || o.isSidechain === true
  const facts: Fact[] = []

  if (type === 'user' || type === 'assistant') {
    if (ts === null) return facts
    if (!ctx.isSubagent) {
      facts.push({
        kind: 'session',
        sessionId,
        ts,
        cwd: str(o.cwd),
        gitBranch: str(o.gitBranch),
        version: str(o.version),
        entrypoint: str(o.entrypoint),
      })
    }
  }

  if (type === 'assistant' && ts !== null) {
    const m = obj(o.message)
    if (!m) return facts
    const model = str(m.model)
    const uuid = str(o.uuid)
    if (o.isApiErrorMessage && uuid) facts.push({ kind: 'event', uuid, sessionId, ts, eventKind: 'api_error' })
    const usage = obj(m.usage)
    const msgId = str(m.id)
    if (model && model !== '<synthetic>' && usage && msgId) {
      const cc = obj(usage.cache_creation)
      let w5 = num(cc?.ephemeral_5m_input_tokens)
      let w1 = num(cc?.ephemeral_1h_input_tokens)
      const totalWrite = num(usage.cache_creation_input_tokens)
      // Older records only carry the total; treat the unexplained part as a 5-minute write.
      if (totalWrite > w5 + w1) w5 += totalWrite - w5 - w1
      facts.push({
        kind: 'api',
        msgId,
        sessionId,
        ts,
        model,
        input: num(usage.input_tokens),
        output: num(usage.output_tokens),
        cacheRead: num(usage.cache_read_input_tokens),
        cacheWrite5m: w5,
        cacheWrite1h: w1,
        webSearch: num(obj(usage.server_tool_use)?.web_search_requests),
        fast: usage.speed === 'fast',
        sidechain,
      })
    }
    if (Array.isArray(m.content)) {
      for (const b of m.content) {
        const block = obj(b)
        if (block?.type !== 'tool_use') continue
        const id = str(block.id)
        const name = str(block.name)
        if (id && name) facts.push({ kind: 'tool_use', id, sessionId, ts, name, mcpServer: mcpServerOf(name), sidechain })
      }
    }
    return facts
  }

  if (type === 'user' && ts !== null) {
    const m = obj(o.message)
    if (!m) return facts
    const { text, toolResults } = userText(m.content)
    const denied = str(o.toolDenialKind)
    for (const r of toolResults) {
      const id = str(r.tool_use_id)
      if (id) facts.push({ kind: 'tool_result', id, sessionId, ts, isError: r.is_error === true, denied })
    }
    const uuid = str(o.uuid)
    if (!uuid || toolResults.length > 0 || ctx.isSubagent) return facts
    if (text.trimStart().startsWith('[Request interrupted')) {
      facts.push({ kind: 'event', uuid, sessionId, ts, eventKind: 'interrupt' })
    } else if (isHumanPrompt(o, text)) {
      facts.push({ kind: 'prompt', uuid, sessionId, ts, promptKind: promptKind(text), preview: previewOf(text) })
    }
    return facts
  }

  if (type === 'system' && ts !== null) {
    const uuid = str(o.uuid)
    if (!uuid) return facts
    if (o.subtype === 'compact_boundary') facts.push({ kind: 'event', uuid, sessionId, ts, eventKind: 'compact' })
    else if (o.subtype === 'api_error') facts.push({ kind: 'event', uuid, sessionId, ts, eventKind: 'api_retry' })
    return facts
  }

  if (type === 'cost-state') {
    const startTime = num(o.startTime)
    if (!startTime || ctx.isSubagent) return facts
    facts.push({
      kind: 'cost',
      sessionId,
      startTime,
      totalCost: num(o.totalCostUSD),
      linesAdded: num(o.totalLinesAdded),
      linesRemoved: num(o.totalLinesRemoved),
      apiMs: num(o.totalAPIDuration),
      toolMs: num(o.totalToolDuration),
      durationMs: num(o.totalDuration),
    })
    return facts
  }

  if (type === 'custom-title' || type === 'ai-title') {
    const title = str(type === 'custom-title' ? o.customTitle : o.aiTitle)
    if (title && !ctx.isSubagent) facts.push({ kind: 'title', sessionId, source: type === 'custom-title' ? 'custom' : 'ai', title })
    return facts
  }

  if (type === 'pr-link') {
    const url = str(o.prUrl)
    if (url && !ctx.isSubagent) {
      facts.push({
        kind: 'pr',
        sessionId,
        url,
        number: typeof o.prNumber === 'number' ? o.prNumber : null,
        repo: str(o.prRepository),
        ts: ts ?? 0,
      })
    }
  }
  return facts
}

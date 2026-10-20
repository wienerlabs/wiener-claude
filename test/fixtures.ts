// Builders for synthetic Claude Code records, shaped like the real ones.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let counter = 0
const uid = (p: string) => `${p}-${++counter}`

export interface Base {
  sessionId?: string
  ts?: string
  cwd?: string
  uuid?: string
  extra?: Record<string, unknown>
}

export function prompt(text: string, o: Base = {}) {
  return {
    type: 'user',
    uuid: o.uuid ?? uid('u'),
    sessionId: o.sessionId ?? 's1',
    timestamp: o.ts ?? '2026-10-01T10:00:00.000Z',
    cwd: o.cwd ?? '/Users/me/code/app',
    gitBranch: 'main',
    version: '2.1.0',
    entrypoint: 'cli',
    origin: { kind: 'human' },
    message: { role: 'user', content: text },
    ...o.extra,
  }
}

export interface Usage {
  input?: number
  output?: number
  read?: number
  write1h?: number
  write5m?: number
  speed?: string
}

export function reply(msgId: string, block: Record<string, unknown>, u: Usage = {}, o: Base & { model?: string } = {}) {
  return {
    type: 'assistant',
    uuid: o.uuid ?? uid('a'),
    sessionId: o.sessionId ?? 's1',
    timestamp: o.ts ?? '2026-10-01T10:00:05.000Z',
    cwd: o.cwd ?? '/Users/me/code/app',
    requestId: `req-${msgId}`,
    message: {
      id: msgId,
      model: o.model ?? 'claude-opus-5-5',
      role: 'assistant',
      content: [block],
      usage: {
        input_tokens: u.input ?? 10,
        output_tokens: u.output ?? 100,
        cache_read_input_tokens: u.read ?? 1000,
        cache_creation_input_tokens: (u.write1h ?? 0) + (u.write5m ?? 0),
        cache_creation: { ephemeral_5m_input_tokens: u.write5m ?? 0, ephemeral_1h_input_tokens: u.write1h ?? 0 },
        speed: u.speed ?? 'standard',
      },
    },
    ...o.extra,
  }
}

export const text = (t: string) => ({ type: 'text', text: t })
export const toolUse = (id: string, name: string, input: Record<string, unknown> = {}) => ({ type: 'tool_use', id, name, input })

export function toolResult(id: string, content: string, isError = false, o: Base = {}) {
  return {
    type: 'user',
    uuid: o.uuid ?? uid('r'),
    sessionId: o.sessionId ?? 's1',
    timestamp: o.ts ?? '2026-10-01T10:00:06.000Z',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] },
    ...o.extra,
  }
}

export function costState(sessionId: string, startTime: number, totalCostUSD: number, lines = { added: 0, removed: 0 }) {
  return {
    type: 'cost-state', sessionId, startTime, totalCostUSD,
    totalLinesAdded: lines.added, totalLinesRemoved: lines.removed,
    totalAPIDuration: 0, totalToolDuration: 0, totalDuration: 0, modelUsage: {},
  }
}

export const jsonl = (records: unknown[]) => records.map((r) => JSON.stringify(r)).join('\n') + '\n'

/** A throwaway ~/.claude/projects tree. */
export function tempProjects(): { root: string; write: (rel: string, content: string) => string; append: (rel: string, content: string) => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wiener-test-'))
  return {
    root,
    write(rel, content) {
      const file = path.join(root, rel)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, content)
      return file
    },
    append(rel, content) {
      fs.appendFileSync(path.join(root, rel), content)
    },
  }
}

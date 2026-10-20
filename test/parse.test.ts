import { describe, expect, it } from 'vitest'
import { cleanPrompt, isHumanPrompt, parseLine, previewOf, promptKind } from '../server/parse.ts'
import { costState, prompt, reply, text, toolResult, toolUse } from './fixtures.ts'

const main = { fileSessionId: 's1', isSubagent: false }

describe('isHumanPrompt', () => {
  it('trusts origin.kind when present', () => {
    expect(isHumanPrompt({ origin: { kind: 'human' } }, '<system-reminder>x</system-reminder> fix it')).toBe(true)
    expect(isHumanPrompt({ origin: { kind: 'task-notification' } }, 'plain text')).toBe(false)
    expect(isHumanPrompt({ origin: { kind: 'peer' } }, 'hello')).toBe(false)
  })

  it('falls back to turnOrigin, then to wrapper tags', () => {
    expect(isHumanPrompt({ turnOrigin: 'human' }, '<artifact-content>…')).toBe(true)
    expect(isHumanPrompt({ turnOrigin: 'task_notification' }, 'hi')).toBe(false)
    expect(isHumanPrompt({}, 'refactor the parser')).toBe(true)
    expect(isHumanPrompt({}, '<command-name>/compact</command-name>')).toBe(true)
    expect(isHumanPrompt({}, '<task-notification>done</task-notification>')).toBe(false)
    expect(isHumanPrompt({}, '<local-command-stdout>ok</local-command-stdout>')).toBe(false)
    expect(isHumanPrompt({}, '[Request interrupted by user]')).toBe(false)
  })

  it('never counts meta, compact summaries, or sidechain records', () => {
    expect(isHumanPrompt({ isMeta: true, origin: { kind: 'human' } }, 'x')).toBe(false)
    expect(isHumanPrompt({ isCompactSummary: true }, 'summary')).toBe(false)
    expect(isHumanPrompt({ isSidechain: true }, 'task for agent')).toBe(false)
  })
})

describe('prompt text', () => {
  it('spells out slash commands and shell input', () => {
    expect(cleanPrompt('<command-name>/review</command-name><command-args>42</command-args>')).toBe('/review 42')
    expect(cleanPrompt('<bash-input>git status</bash-input>')).toBe('! git status')
    expect(promptKind('<command-name>/x</command-name>')).toBe('command')
    expect(promptKind('<bash-input>ls</bash-input>')).toBe('bash')
  })

  it('drops injected reminders and shortens pasted content in previews', () => {
    expect(cleanPrompt('<system-reminder>ctx</system-reminder>\nAsıl istek')).toBe('Asıl istek')
    expect(previewOf('Bak: <pasted_content id="1">uzun log</pasted_content> neden?')).toBe('Bak: uzun log neden?')
    expect(previewOf('x'.repeat(400))).toHaveLength(280)
  })
})

describe('parseLine', () => {
  it('turns an assistant record into session, api and tool facts', () => {
    const facts = parseLine(reply('m1', toolUse('t1', 'mcp__github__create_pr'), { output: 50, write1h: 200 }), main)
    expect(facts.map((f) => f.kind)).toEqual(['session', 'api', 'tool_use'])
    const api = facts.find((f) => f.kind === 'api')
    expect(api).toMatchObject({ msgId: 'm1', output: 50, cacheWrite1h: 200, cacheWrite5m: 0, sidechain: false })
    expect(facts.find((f) => f.kind === 'tool_use')).toMatchObject({ name: 'mcp__github__create_pr', mcpServer: 'github' })
  })

  it('treats the unexplained part of an old cache-write total as a 5-minute write', () => {
    const r = reply('m1', text('hi'))
    r.message.usage.cache_creation_input_tokens = 300
    r.message.usage.cache_creation = { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 100 }
    expect(parseLine(r, main).find((f) => f.kind === 'api')).toMatchObject({ cacheWrite1h: 100, cacheWrite5m: 200 })
  })

  it('skips usage of synthetic error messages but records the error', () => {
    const r = reply('m1', text('API Error: overloaded'), {}, { model: '<synthetic>', extra: { isApiErrorMessage: true } })
    const facts = parseLine(r, main)
    expect(facts.some((f) => f.kind === 'api')).toBe(false)
    expect(facts.find((f) => f.kind === 'event')).toMatchObject({ eventKind: 'api_error' })
  })

  it('marks denied tool results', () => {
    const facts = parseLine(toolResult('t1', 'denied', true, { extra: { toolDenialKind: 'user-rejected' } }), main)
    expect(facts.filter((f) => f.kind !== 'session')).toEqual([
      expect.objectContaining({ kind: 'tool_result', id: 't1', isError: true, denied: 'user-rejected' }),
    ])
  })

  it('attributes subagent records to the parent session, as sidechain, without prompts', () => {
    const sub = { fileSessionId: 'parent', isSubagent: true }
    const facts = parseLine(reply('m9', text('done'), {}, { sessionId: 'other' }), sub)
    expect(facts).toEqual([expect.objectContaining({ kind: 'api', sessionId: 'parent', sidechain: true })])
    expect(parseLine(prompt('task from parent', { sessionId: 'parent' }), sub)).toEqual([])
  })

  it('reads cost-state, titles and PR links', () => {
    expect(parseLine(costState('s1', 1000, 4.5, { added: 10, removed: 2 }), main)).toEqual([
      expect.objectContaining({ kind: 'cost', startTime: 1000, totalCost: 4.5, linesAdded: 10, linesRemoved: 2 }),
    ])
    expect(parseLine({ type: 'custom-title', sessionId: 's1', customTitle: 'Benim başlığım' }, main)).toEqual([
      { kind: 'title', sessionId: 's1', source: 'custom', title: 'Benim başlığım' },
    ])
    expect(parseLine({ type: 'pr-link', sessionId: 's1', prUrl: 'https://x/pull/3', prNumber: 3, timestamp: '2026-10-01T10:00:00Z' }, main))
      .toEqual([expect.objectContaining({ kind: 'pr', number: 3 })])
  })

  it('records interruptions as events, not prompts', () => {
    const facts = parseLine(prompt('[Request interrupted by user]', { extra: { origin: undefined } }), main)
    expect(facts.map((f) => f.kind)).toEqual(['session', 'event'])
  })
})

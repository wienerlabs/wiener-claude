import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { dataDir } from './paths.ts'

/** Dollars per million tokens. Cache writes default to 1.25x (5 min TTL) and 2x (1 h TTL) of input. */
export interface ModelPrice {
  input: number
  output: number
  cacheRead: number
  cacheWrite5m?: number
  cacheWrite1h?: number
  /** Prompts (input + cache) above `threshold` tokens are billed at these rates instead. */
  longPrompt?: { threshold: number; input: number; output: number; cacheRead: number }
  /** Multiplier applied to every rate when usage.speed is "fast". Only set where documented. */
  fastMultiplier?: number
}

const WEB_SEARCH_PER_REQUEST = 10 / 1000

// Anthropic first-party list prices, as of 2026-10.
const DEFAULT_PRICES: Record<string, ModelPrice> = {
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25 },
  'claude-mythos-5-1': { input: 10, output: 50, cacheRead: 0.25 },
  'claude-fable-5': { input: 10, output: 50, cacheRead: 1 },
  'claude-mythos-5': { input: 10, output: 50, cacheRead: 1 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, fastMultiplier: 2 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, fastMultiplier: 2 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-7': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-6': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-1': { input: 15, output: 75, cacheRead: 1.5 },
  'claude-opus-4': { input: 15, output: 75, cacheRead: 1.5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3 },
  'claude-sonnet-4-5': { input: 3, output: 15, cacheRead: 0.3 },
  'claude-sonnet-4': { input: 3, output: 15, cacheRead: 0.3 },
  'claude-3-7-sonnet': { input: 3, output: 15, cacheRead: 0.3 },
  'claude-haiku-5-5': {
    input: 0.1, output: 0.5, cacheRead: 0.01,
    longPrompt: { threshold: 100_000, input: 0.5, output: 2.5, cacheRead: 0.05 },
  },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1 },
  'claude-3-5-haiku': { input: 0.8, output: 4, cacheRead: 0.08 },
}

export interface Usage {
  input: number
  output: number
  cacheRead: number
  cacheWrite5m: number
  cacheWrite1h: number
  webSearch: number
  fast: boolean
}

/** "us.anthropic.claude-opus-4-8-20260101[1m]" -> "claude-opus-4-8" */
export function normalizeModel(model: string): string {
  let m = model.trim().toLowerCase()
  m = m.replace(/\[[^\]]*\]$/, '')
  m = m.replace(/^(?:[a-z]{2,4}\.)?anthropic\./, '')
  m = m.replace(/@\d{8}$/, '').replace(/-\d{8}$/, '').replace(/-v\d+(?::\d+)?$/, '')
  return m
}

export class Pricing {
  readonly prices: Record<string, ModelPrice>
  readonly version: string

  constructor(overrides: Record<string, ModelPrice> = {}) {
    this.prices = { ...DEFAULT_PRICES, ...overrides }
    this.version = createHash('sha1').update(JSON.stringify(this.prices)).digest('hex').slice(0, 12)
  }

  /** Loads ~/.wiener-tools/pricing.json on top of the defaults, ignoring a malformed file. */
  static load(): Pricing {
    const file = path.join(dataDir(), 'pricing.json')
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, ModelPrice>
      const clean: Record<string, ModelPrice> = {}
      for (const [k, v] of Object.entries(raw)) {
        if (v && typeof v.input === 'number' && typeof v.output === 'number') {
          clean[normalizeModel(k)] = { ...v, cacheRead: typeof v.cacheRead === 'number' ? v.cacheRead : v.input * 0.1 }
        }
      }
      return new Pricing(clean)
    } catch {
      return new Pricing()
    }
  }

  has(model: string): boolean {
    return normalizeModel(model) in this.prices
  }

  /** Estimated list price in dollars, or null for a model with no known price. */
  cost(model: string, u: Usage): number | null {
    const p = this.prices[normalizeModel(model)]
    if (!p) return null
    const prompt = u.input + u.cacheRead + u.cacheWrite5m + u.cacheWrite1h
    const long = p.longPrompt && prompt > p.longPrompt.threshold ? p.longPrompt : null
    const input = long ? long.input : p.input
    const output = long ? long.output : p.output
    const cacheRead = long ? long.cacheRead : p.cacheRead
    const write5m = long ? input * 1.25 : p.cacheWrite5m ?? input * 1.25
    const write1h = long ? input * 2 : p.cacheWrite1h ?? input * 2
    const mult = u.fast && p.fastMultiplier ? p.fastMultiplier : 1
    const tokens =
      u.input * input + u.output * output + u.cacheRead * cacheRead + u.cacheWrite5m * write5m + u.cacheWrite1h * write1h
    return (tokens / 1e6) * mult + u.webSearch * WEB_SEARCH_PER_REQUEST
  }
}

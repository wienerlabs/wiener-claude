import type { RangeInfo, RangeKey } from '../shared/types.ts'
import type { Db } from './db.ts'
import { addDays, today, weekStart } from './time.ts'

export const RANGE_KEYS: RangeKey[] = ['week', '30d', 'all']

export function parseRange(value: string | undefined | null, fallback: RangeKey): RangeKey {
  return RANGE_KEYS.includes(value as RangeKey) ? (value as RangeKey) : fallback
}

const dayCount = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00`) - Date.parse(`${from}T12:00:00`)) / 86_400_000) + 1

/** First and last day of a range, both inclusive and local; "all" starts on the first recorded day. */
export function rangeBounds(db: Db, key: RangeKey): RangeInfo & { fromMs: number } {
  const to = today()
  let from: string
  if (key === 'week') from = weekStart(to)
  else if (key === '30d') from = addDays(to, -29)
  else {
    const row = db.prepare('SELECT min(day) AS d FROM (SELECT min(day) AS day FROM api_calls UNION ALL SELECT min(day) FROM prompts)').get() as { d: string | null }
    from = row.d && row.d < to ? row.d : to
  }
  return { key, from, to, days: dayCount(from, to), fromMs: Date.parse(`${from}T00:00:00`) }
}

/**
 * The period to compare a range with: the same weekdays of last week, or the equally long stretch
 * right before the last 30 days. "All" has nothing before it.
 */
export function previousBounds(range: RangeInfo): { from: string; to: string } | null {
  if (range.key === 'all') return null
  if (range.key === 'week') return { from: addDays(range.from, -7), to: addDays(range.to, -7) }
  return { from: addDays(range.from, -range.days), to: addDays(range.from, -1) }
}

/** Longer ranges are drawn in weeks so bars and cells stay readable. */
export const WEEKLY_AFTER_DAYS = 92

import type { RangeKey } from '../../../shared/types.ts'
import { Segmented } from '../components/ui.tsx'
import { tx } from './i18n.ts'
import { navigate, useLocation } from './router.ts'

// Slugs stay Turkish in both languages, so shared links open on the same range.
const RANGES: { value: RangeKey; slug: string }[] = [
  { value: 'week', slug: 'hafta' },
  { value: '30d', slug: '30-gun' },
  { value: 'all', slug: 'tum' },
]

export function rangeLabel(key: RangeKey): string {
  return key === 'week' ? tx('Bu hafta', 'This week') : key === '30d' ? tx('Son 30 gün', 'Last 30 days') : tx('Tüm zamanlar', 'All time')
}

/**
 * The range as the start of a sentence: "Bu hafta", "Son 30 günde", "Tüm zamanlarda"; in English
 * "This week", "In the last 30 days", "Across all time".
 */
export function rangeSpan(key: RangeKey): string {
  return key === 'week' ? tx('Bu hafta', 'This week') : key === '30d' ? tx('Son 30 günde', 'In the last 30 days') : tx('Tüm zamanlarda', 'Across all time')
}

/** The selected range lives in ?donem=, so reloads, back/forward and shared links keep it. */
export function useRange(fallback: RangeKey): [RangeKey, (key: RangeKey) => void] {
  const { path, query } = useLocation()
  const key = RANGES.find((r) => r.slug === query.get('donem'))?.value ?? fallback
  const set = (next: RangeKey) => {
    const q = new URLSearchParams(query)
    if (next === fallback) q.delete('donem')
    else q.set('donem', RANGES.find((r) => r.value === next)?.slug ?? '')
    navigate(q.size ? `${path}?${q}` : path, { replace: true })
  }
  return [key, set]
}

/** A link that opens on the same range; ?donem= is left out when it is the target page's default. */
export function rangeHref(path: string, key: RangeKey, fallback: RangeKey = '30d'): string {
  if (key === fallback) return path
  const slug = RANGES.find((r) => r.value === key)?.slug ?? ''
  return `${path}${path.includes('?') ? '&' : '?'}donem=${slug}`
}

export function RangePicker({ value, onChange }: { value: RangeKey; onChange: (key: RangeKey) => void }) {
  return <Segmented label={tx('Dönem', 'Period')} value={value} onChange={onChange} options={RANGES.map((r) => ({ value: r.value, label: rangeLabel(r.value) }))} />
}

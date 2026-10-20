import type { RangeKey } from '../../../shared/types.ts'
import { Segmented } from '../components/ui.tsx'
import { navigate, useLocation } from './router.ts'

export const RANGES: { value: RangeKey; label: string; slug: string; span: string }[] = [
  { value: 'week', label: 'Bu hafta', slug: 'hafta', span: 'Bu hafta' },
  { value: '30d', label: 'Son 30 gün', slug: '30-gun', span: 'Son 30 günde' },
  { value: 'all', label: 'Tüm zamanlar', slug: 'tum', span: 'Tüm zamanlarda' },
]

/** "Bu hafta", "Son 30 günde", "Tüm zamanlarda": the range as the start of a sentence. */
export const rangeSpan = (key: RangeKey) => RANGES.find((r) => r.value === key)?.span ?? ''

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
  return <Segmented label="Dönem" value={value} onChange={onChange} options={RANGES.map((r) => ({ value: r.value, label: r.label }))} />
}

import { useCallback, useRef, useState } from 'react'
import type { Metric } from '../../../../shared/types.ts'
import { fmtMetricShort } from '../../lib/format.ts'
import { tx } from '../../lib/i18n.ts'

export const HEAT = ['var(--heat-0)', 'var(--heat-1)', 'var(--heat-2)', 'var(--heat-3)', 'var(--heat-4)'] as const

/**
 * Usage is heavily skewed, so a linear scale would paint almost every day the faintest step.
 * Steps split the non-zero values into quartiles instead; the legend prints each range.
 */
export function quartiles(values: number[]): [number, number, number] {
  const nz = values.filter((v) => v > 0).sort((a, b) => a - b)
  if (nz.length === 0) return [0, 0, 0]
  const at = (p: number) => nz[Math.min(nz.length - 1, Math.floor(p * nz.length))] as number
  const t1 = at(0.25)
  const t2 = Math.max(at(0.5), t1)
  const t3 = Math.max(at(0.75), t2)
  return [t1, t2, t3]
}

export function levelOf(v: number, t: [number, number, number]): number {
  if (v <= 0) return 0
  if (v <= t[0]) return 1
  if (v <= t[1]) return 2
  if (v <= t[2]) return 3
  return 4
}

export function Legend({ metric, t, max }: { metric: Metric; t: [number, number, number]; max: number }) {
  const f = (v: number) => fmtMetricShort(metric, v)
  const ranges = max <= 0 ? [] : [`${f(0)}`, `≤ ${f(t[0])}`, `≤ ${f(t[1])}`, `≤ ${f(t[2])}`, `≤ ${f(max)}`]
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-3 font-mono num" aria-label={tx('Renk ölçeği', 'Color scale')}>
      {ranges.map((label, i) => (
        <span key={label + i} className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-[3px]" style={{ background: HEAT[i] }} aria-hidden />
          {label}
        </span>
      ))}
    </div>
  )
}

export interface TipContent {
  value: string
  label: string
  /** Optional breakdown lines under the label, e.g. cost per model. */
  rows?: [string, string][]
}

/**
 * One floating tooltip for a whole grid. It lives outside the grid's scroll box (which would clip
 * it) and flips its anchor near the edges so it never runs off the card.
 */
export function useTooltip() {
  const box = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<(TipContent & { x: number; y: number; align: 'left' | 'center' | 'right' }) | null>(null)

  const show = useCallback((el: Element, content: TipContent) => {
    const host = box.current
    if (!host) return
    const r = el.getBoundingClientRect()
    const h = host.getBoundingClientRect()
    const mid = r.left - h.left + r.width / 2
    const align = mid < 110 ? 'left' : mid > h.width - 110 ? 'right' : 'center'
    const x = align === 'left' ? r.left - h.left : align === 'right' ? r.right - h.left : mid
    setTip({ ...content, x, y: r.top - h.top, align })
  }, [])
  const hide = useCallback(() => setTip(null), [])

  const shift = tip?.align === 'left' ? 'translate(0, -100%)' : tip?.align === 'right' ? 'translate(-100%, -100%)' : 'translate(-50%, -100%)'
  const node = tip ? (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-20 whitespace-nowrap rounded-md border border-line bg-surface px-2.5 py-1.5 shadow-[0_4px_16px_rgba(0,0,0,0.12)]"
      style={{ left: tip.x, top: tip.y - 6, transform: shift }}
    >
      <div className="font-mono num text-[13px] font-medium text-ink">{tip.value}</div>
      <div className="text-[11px] text-ink-2">{tip.label}</div>
      {tip.rows?.length ? (
        <div className="mt-1 space-y-0.5 border-t border-line pt-1">
          {tip.rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 text-[11px] text-ink-2">
              <span>{k}</span>
              <span className="font-mono num text-ink">{v}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  ) : null

  return { box, show, hide, node }
}

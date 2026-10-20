import { useEffect, useMemo, useRef, useState } from 'react'
import type { DailyCost } from '../../../shared/types.ts'
import { fmtDayLong, fmtDayMonthShort, fmtDayShort, fmtUsd, modelName, monthsShort, parseDay } from '../lib/format.ts'
import { tx } from '../lib/i18n.ts'
import { HEAT, levelOf, quartiles, useTooltip } from './heatmap/scale.tsx'

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry?.contentRect.width ?? 0)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

/** A round axis maximum: 1, 2 or 5 times a power of ten. */
export function niceMax(v: number): number {
  if (v <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 2, 5, 10]) if (m * p >= v) return m * p
  return 10 * p
}

/** One bar per day; hovering a day lists what each model cost. */
export function DailyBars({ data, bucket = 'day', height = 180 }: { data: DailyCost[]; bucket?: 'day' | 'week'; height?: number }) {
  const [wrap, width] = useWidth<HTMLDivElement>()
  const { box, show, hide, node } = useTooltip()
  const max0 = niceMax(Math.max(...data.map((d) => d.cost), 0))
  const axisLabel = (v: number) => fmtUsd(v).replace(tx(/,00$/, /\.00$/), '')
  // Wide enough for the longest axis label ("$5.000"), in 11px monospace.
  const axis = Math.max(36, axisLabel(max0).length * 7 + 12)
  const bottom = 20
  // Room above the top gridline so its label isn't clipped.
  const top = 8
  const max = max0
  const plotW = Math.max(0, width - axis)
  const step = data.length ? plotW / data.length : 0
  // A few days would make slabs; cap the width and center each bar in its slot.
  const barW = Math.max(2, Math.min(step - 2, 40))
  const inset = (step - barW) / 2
  const y = (v: number) => top + (height - bottom - top) * (1 - v / max)

  return (
    <div ref={box} className="relative" onMouseLeave={hide}>
      <div ref={wrap} className="w-full">
        {width > 0 ? (
          <svg width={width} height={height} role="img" aria-label={bucket === 'week' ? tx('Haftalık maliyet', 'Weekly cost') : tx('Günlük maliyet', 'Daily cost')}>
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line x1={axis} x2={width} y1={y(max * f)} y2={y(max * f)} stroke="var(--line)" strokeWidth={1} />
                <text x={axis - 8} y={y(max * f)} dy="0.32em" textAnchor="end" className="fill-ink-3 font-mono text-[11px]">
                  {axisLabel(max * f)}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const x = axis + i * step + inset
              const h = height - bottom - y(d.cost)
              const date = parseDay(d.day)
              const label =
                bucket === 'week'
                  ? date.getDate() <= 7 ? monthsShort()[date.getMonth()] ?? '' : ''
                  : data.length <= 10
                    ? i === 0 || date.getDate() === 1 ? fmtDayMonthShort(date) : String(date.getDate())
                    : i === 0 || date.getDate() === 1 ? fmtDayMonthShort(date) : date.getDay() === 1 ? String(date.getDate()) : ''
              const when = bucket === 'week' ? tx(`${fmtDayShort(d.day)} haftası`, `Week of ${fmtDayShort(d.day)}`) : fmtDayLong(d.day)
              const rows = Object.entries(d.byModel)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 4)
                .map(([m, v]): [string, string] => [modelName(m), fmtUsd(v)])
              return (
                <g key={d.day}>
                  {h > 0 ? <rect x={x} y={y(d.cost)} width={barW} height={h} rx={Math.min(3, barW / 2)} fill="var(--heat-3)" /> : null}
                  {label ? (
                    <text x={x + barW / 2} y={height - 4} textAnchor="middle" className="fill-ink-3 font-mono text-[11px]">
                      {label}
                    </text>
                  ) : null}
                  {/* The hit target is the whole column, not just the bar. */}
                  <rect
                    x={axis + i * step}
                    y={0}
                    width={step}
                    height={height - bottom}
                    fill="transparent"
                    tabIndex={0}
                    aria-label={`${when}: ${fmtUsd(d.cost)}`}
                    onMouseEnter={(e) => show(e.currentTarget, { value: fmtUsd(d.cost), label: when, rows })}
                    onFocus={(e) => show(e.currentTarget, { value: fmtUsd(d.cost), label: when, rows })}
                    onBlur={hide}
                  />
                </g>
              )
            })}
          </svg>
        ) : (
          <div style={{ height }} />
        )}
      </div>
      {node}
    </div>
  )
}

/** Horizontal bars for one measure across named items. */
export function HBars({ items, format }: { items: { label: string; value: number; note?: string }[]; format: (v: number) => string }) {
  const max = Math.max(...items.map((i) => i.value), 0)
  return (
    <ul className="space-y-2">
      {items.map((it) => (
        <li key={it.label} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 text-[13px]">
          <span className="truncate text-ink-2" title={it.label}>{it.label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-line/50">
            <span className="block h-full rounded-full bg-[var(--heat-3)]" style={{ width: `${max > 0 ? (it.value / max) * 100 : 0}%` }} />
          </span>
          <span className="text-right font-mono text-[12px] num">
            {format(it.value)}
            {it.note ? <span className="ml-1.5 text-ink-3">{it.note}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** Parts of a whole as one bar, each part labeled with its share and amount below. */
export function ShareBar({ parts, format }: { parts: { label: string; value: number; color: string; detail?: string }[]; format: (v: number) => string }) {
  const total = parts.reduce((s, p) => s + p.value, 0)
  const shown = parts.filter((p) => p.value > 0)
  return (
    <div>
      <div className="flex h-3 gap-[2px] overflow-hidden rounded-full" role="img" aria-label={shown.map((p) => tx(`${p.label} %${Math.round((p.value / total) * 100)}`, `${p.label} ${Math.round((p.value / total) * 100)}%`)).join(', ')}>
        {shown.map((p) => (
          <span key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />
        ))}
      </div>
      <ul className="mt-3 space-y-1.5">
        {parts.map((p) => (
          <li key={p.label} className="flex items-baseline gap-2 text-[13px]">
            <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: p.color }} aria-hidden />
            <span className="min-w-0 flex-1 text-ink-2">
              {p.label}
              {p.detail ? <span className="block text-[12px] text-ink-3 num">{p.detail}</span> : null}
            </span>
            <span className="font-mono text-[12px] num">{total > 0 ? tx(`%${Math.round((p.value / total) * 100)}`, `${Math.round((p.value / total) * 100)}%`) : '—'}</span>
            <span className="w-20 text-right font-mono text-[12px] text-ink-2 num">{format(p.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Twelve weeks of activity in a small grid, oldest column on the left. */
export function MiniStrip({ values, label }: { values: number[]; label: string }) {
  const t = useMemo(() => quartiles(values), [values])
  const weeks = Math.ceil(values.length / 7)
  return (
    <div className="grid grid-flow-col grid-rows-7 gap-[2px]" style={{ gridTemplateColumns: `repeat(${weeks}, 6px)` }} role="img" aria-label={label}>
      {values.map((v, i) => (
        <span key={i} className="size-[6px] rounded-[1.5px]" style={{ background: HEAT[levelOf(v, t)] }} />
      ))}
    </div>
  )
}

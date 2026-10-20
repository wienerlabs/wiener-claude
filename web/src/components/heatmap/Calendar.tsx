import { useEffect, useMemo, useRef } from 'react'
import type { HeatmapResponse } from '../../../../shared/types.ts'
import { MONTHS_SHORT, dayKey, fmtDayLong, fmtMetric, parseDay } from '../../lib/format.ts'
import { HEAT, Legend, levelOf, quartiles, useTooltip } from './scale.tsx'

const ROW_LABELS = ['Pzt', '', 'Çar', '', 'Cum', '', '']

interface Props {
  data: HeatmapResponse
  selected: string | null
  onSelect: (day: string | null) => void
}

/** A year of days: one column per week (Monday first), one cell per day. */
export function Calendar({ data, selected, onSelect }: Props) {
  const { box, show, hide, node } = useTooltip()
  const scroller = useRef<HTMLDivElement>(null)

  const { weeks, t } = useMemo(() => {
    const values = new Map(data.cells.map((c) => [c.key, c.value]))
    const start = parseDay(data.from)
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
    const end = parseDay(data.to)
    const weeks: { key: string; date: Date; value: number; inRange: boolean }[][] = []
    for (const d = new Date(start); d <= end; ) {
      const week = []
      for (let i = 0; i < 7; i++) {
        const key = dayKey(d)
        week.push({ key, date: new Date(d), value: values.get(key) ?? 0, inRange: key >= data.from && key <= data.to })
        d.setDate(d.getDate() + 1)
      }
      weeks.push(week)
    }
    return { weeks, t: quartiles(data.cells.map((c) => c.value)) }
  }, [data])

  // Recent weeks matter most; on narrow screens start scrolled to today.
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [weeks.length])

  const cols = `1.75rem repeat(${weeks.length}, minmax(11px, 1fr))`
  return (
    <div ref={box} className="relative" onMouseLeave={hide}>
      <div ref={scroller} className="overflow-x-auto pb-1" onScroll={hide}>
        <div className="min-w-[640px]">
          <div className="grid gap-[3px]" style={{ gridTemplateColumns: cols }}>
            <span className="sticky left-0 z-10 bg-surface" />
            {weeks.map((w, i) => {
              const first = w.find((d) => d.date.getDate() === 1)
              return (
                <span key={`m${i}`} className="h-4 overflow-visible whitespace-nowrap text-[11px] leading-4 text-ink-3">
                  {first ? MONTHS_SHORT[first.date.getMonth()] : ''}
                </span>
              )
            })}
            {ROW_LABELS.map((label, row) => (
              <Row key={row} label={label}>
                {weeks.map((w) => {
                  const d = w[row]
                  if (!d || !d.inRange) return <span key={`${row}-${d?.key}`} />
                  const tip = { value: fmtMetric(data.metric, d.value), label: fmtDayLong(d.key) }
                  return (
                    <button
                      key={d.key}
                      type="button"
                      className="heat-cell aspect-square w-full cursor-pointer"
                      style={{ background: HEAT[levelOf(d.value, t)] }}
                      aria-label={`${tip.label}: ${tip.value}`}
                      aria-pressed={selected === d.key}
                      onMouseEnter={(e) => show(e.currentTarget, tip)}
                      onFocus={(e) => show(e.currentTarget, tip)}
                      onBlur={hide}
                      onClick={() => {
                        hide()
                        onSelect(selected === d.key ? null : d.key)
                      }}
                    />
                  )
                })}
              </Row>
            ))}
          </div>
        </div>
      </div>
      {node}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12px] text-ink-3">Bir güne tıkla, o günün oturumları açılsın.</span>
        <Legend metric={data.metric} t={t} max={data.max} />
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <span className="sticky left-0 z-10 flex items-center bg-surface text-[11px] text-ink-3">{label}</span>
      {children}
    </>
  )
}

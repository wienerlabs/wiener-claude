import { useMemo } from 'react'
import type { HeatmapResponse } from '../../../../shared/types.ts'
import { WEEKDAYS, WEEKDAYS_SHORT, fmtMetric } from '../../lib/format.ts'
import { HEAT, Legend, levelOf, quartiles, useTooltip } from './scale.tsx'

const hh = (h: number) => String(h).padStart(2, '0')

/** Weekday by hour of day: when in the week the work happens. */
export function WeekHour({ data }: { data: HeatmapResponse }) {
  const { box, show, hide, node } = useTooltip()
  const { values, t } = useMemo(
    () => ({ values: new Map(data.cells.map((c) => [c.key, c.value])), t: quartiles(data.cells.map((c) => c.value)) }),
    [data],
  )
  return (
    <div ref={box} className="relative" onMouseLeave={hide}>
      <div className="overflow-x-auto pb-1" onScroll={hide}>
        <div role="grid" aria-label="Haftanın günü ve saate göre yoğunluk" className="min-w-[560px]">
          <div className="grid gap-[3px]" style={{ gridTemplateColumns: '2.25rem repeat(24, minmax(0, 1fr))' }}>
            <span className="sticky left-0 z-10 bg-surface" />
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="h-4 text-[11px] leading-4 text-ink-3 font-mono num">
                {h % 3 === 0 ? hh(h) : ''}
              </span>
            ))}
            {WEEKDAYS_SHORT.map((label, dow) => (
              <div key={label} role="row" className="contents">
                <span className="sticky left-0 z-10 flex items-center bg-surface text-[11px] text-ink-3">{label}</span>
                {Array.from({ length: 24 }, (_, h) => {
                  const v = values.get(`${dow}:${h}`) ?? 0
                  const tip = { value: fmtMetric(data.metric, v), label: `${WEEKDAYS[dow]} ${hh(h)}:00–${hh((h + 1) % 24)}:00` }
                  return (
                    <div
                      key={h}
                      role="gridcell"
                      tabIndex={-1}
                      aria-label={`${tip.label}: ${tip.value}`}
                      className="heat-cell h-6"
                      style={{ background: HEAT[levelOf(v, t)] }}
                      onMouseEnter={(e) => show(e.currentTarget, tip)}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      {node}
      <div className="mt-3 flex justify-end">
        <Legend metric={data.metric} t={t} max={data.max} />
      </div>
    </div>
  )
}

import { useMemo } from 'react'
import type { HeatmapResponse } from '../../../../shared/types.ts'
import { MONTHS_SHORT, dayKey, fmtDayLong, fmtMetric, fmtMetricShort, parseDay } from '../../lib/format.ts'
import { HEAT, Legend, levelOf, quartiles, useTooltip } from './scale.tsx'

interface Props {
  data: HeatmapResponse
  selected: string | null
  onSelect: (day: string | null) => void
}

/** One row per project, one column per day: which week went into which project. */
export function ProjectDay({ data, selected, onSelect }: Props) {
  const { box, show, hide, node } = useTooltip()
  const { days, values, t } = useMemo(() => {
    const days: string[] = []
    for (const d = parseDay(data.from); dayKey(d) <= data.to; d.setDate(d.getDate() + 1)) days.push(dayKey(d))
    return {
      days,
      values: new Map(data.cells.map((c) => [c.key, c.value])),
      t: quartiles(data.cells.map((c) => c.value)),
    }
  }, [data])

  if (data.projects.length === 0) return <p className="py-10 text-center text-ink-2">Bu aralıkta proje etkinliği yok.</p>

  const cols = `minmax(7rem, 11rem) repeat(${days.length}, minmax(9px, 1fr)) 4.5rem`
  return (
    <div ref={box} className="relative" onMouseLeave={hide}>
      <div className="overflow-x-auto pb-1" onScroll={hide}>
        <div className="min-w-[600px]">
          <div className="grid items-center gap-[3px]" style={{ gridTemplateColumns: cols }}>
            <span className="sticky left-0 z-10 self-stretch bg-surface" />
            {days.map((day) => {
              const d = parseDay(day)
              const label = d.getDate() === 1 || day === days[0] ? `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}` : d.getDay() === 1 ? String(d.getDate()) : ''
              return (
                <span key={day} className="h-4 overflow-visible whitespace-nowrap text-[11px] leading-4 text-ink-3 font-mono num">
                  {label}
                </span>
              )
            })}
            <span />
            {data.projects.map((p) => (
              <div key={p.key} className="contents">
                <span className="sticky left-0 z-10 truncate bg-surface pr-2 text-[13px] text-ink-2" title={p.name}>
                  {p.name}
                </span>
                {days.map((day) => {
                  const v = values.get(`${p.key}|${day}`) ?? 0
                  const tip = { value: fmtMetric(data.metric, v), label: `${p.name} · ${fmtDayLong(day)}` }
                  return (
                    <button
                      key={day}
                      type="button"
                      className="heat-cell h-5 w-full cursor-pointer"
                      style={{ background: HEAT[levelOf(v, t)] }}
                      aria-label={`${tip.label}: ${tip.value}`}
                      aria-pressed={selected === day}
                      onMouseEnter={(e) => show(e.currentTarget, tip)}
                      onFocus={(e) => show(e.currentTarget, tip)}
                      onBlur={hide}
                      onClick={() => {
                        hide()
                        onSelect(selected === day ? null : day)
                      }}
                    />
                  )
                })}
                <span className="pl-2 text-right text-[12px] text-ink-3 font-mono num">{fmtMetricShort(data.metric, p.total)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      {node}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12px] text-ink-3">En çok etkinlik olan {Math.min(10, data.projects.length)} proje. Bir hücreye tıkla, o gün açılsın.</span>
        <Legend metric={data.metric} t={t} max={data.max} />
      </div>
    </div>
  )
}

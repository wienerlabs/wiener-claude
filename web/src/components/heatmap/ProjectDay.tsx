import { useMemo } from 'react'
import type { HeatmapResponse } from '../../../../shared/types.ts'
import { dayKey, fmtDayLong, fmtDayMonthShort, fmtDayShort, fmtMetric, fmtMetricShort, monthsShort, parseDay } from '../../lib/format.ts'
import { tx } from '../../lib/i18n.ts'
import { HEAT, Legend, levelOf, quartiles, useTooltip } from './scale.tsx'

interface Props {
  data: HeatmapResponse
  selected: string | null
  onSelect: (day: string | null) => void
}

/** One row per project, one column per day: which week went into which project. */
export function ProjectDay({ data, selected, onSelect }: Props) {
  const { box, show, hide, node } = useTooltip()
  const weekly = data.bucket === 'week'
  const { days, values, t } = useMemo(() => {
    // An older server sends no column list; fall back to one column per day.
    const days = [...(data.columns ?? [])]
    if (days.length === 0) for (const d = parseDay(data.from); dayKey(d) <= data.to; d.setDate(d.getDate() + 1)) days.push(dayKey(d))
    return {
      days,
      values: new Map(data.cells.map((c) => [c.key, c.value])),
      t: quartiles(data.cells.map((c) => c.value)),
    }
  }, [data])
  const columnLabel = (day: string, i: number) => {
    const d = parseDay(day)
    if (weekly) return d.getDate() <= 7 ? monthsShort()[d.getMonth()] : ''
    return d.getDate() === 1 || i === 0 ? fmtDayMonthShort(d) : d.getDay() === 1 ? String(d.getDate()) : ''
  }

  if (data.projects.length === 0) return <p className="py-10 text-center text-ink-2">{tx('Bu aralıkta proje etkinliği yok.', 'No project activity in this range.')}</p>

  const cols = `minmax(7rem, 11rem) repeat(${days.length}, minmax(${weekly ? 14 : 9}px, 1fr)) 4.5rem`
  return (
    <div ref={box} className="relative" onMouseLeave={hide}>
      <div className="overflow-x-auto pb-1" onScroll={hide}>
        <div className="min-w-[600px]">
          <div className="grid items-center gap-[3px]" style={{ gridTemplateColumns: cols }}>
            <span className="sticky left-0 z-10 self-stretch bg-surface" />
            {days.map((day, i) => (
              <span key={day} className="h-4 overflow-visible whitespace-nowrap text-[11px] leading-4 text-ink-3 font-mono num">
                {columnLabel(day, i)}
              </span>
            ))}
            <span />
            {data.projects.map((p) => (
              <div key={p.key} className="contents">
                <span className="sticky left-0 z-10 truncate bg-surface pr-2 text-[13px] text-ink-2" title={p.name}>
                  {p.name}
                </span>
                {days.map((day) => {
                  const v = values.get(`${p.key}|${day}`) ?? 0
                  const tip = { value: fmtMetric(data.metric, v), label: `${p.name} · ${weekly ? tx(`${fmtDayShort(day)} haftası`, `Week of ${fmtDayShort(day)}`) : fmtDayLong(day)}` }
                  // A week is not a day: weekly cells show their tooltip but open no day ledger.
                  if (weekly) {
                    return (
                      <div
                        key={day}
                        role="img"
                        aria-label={`${tip.label}: ${tip.value}`}
                        className="heat-cell h-5 w-full"
                        style={{ background: HEAT[levelOf(v, t)] }}
                        onMouseEnter={(e) => show(e.currentTarget, tip)}
                      />
                    )
                  }
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
        <span className="text-[12px] text-ink-3">
          {tx(
            `En çok etkinlik olan ${Math.min(10, data.projects.length)} proje.`,
            Math.min(10, data.projects.length) === 1 ? 'The most active project.' : `The ${Math.min(10, data.projects.length)} most active projects.`,
          )}{' '}
          {weekly ? tx('Her sütun bir hafta.', 'Each column is a week.') : tx('Bir hücreye tıkla, o gün açılsın.', 'Click a cell to open that day.')}
        </span>
        <Legend metric={data.metric} t={t} max={data.max} />
      </div>
    </div>
  )
}

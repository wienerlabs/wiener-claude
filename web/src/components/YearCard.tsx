import { type Ref, useMemo } from 'react'
import type { YearReport } from '../../../shared/types.ts'
import { MONTHS_SHORT, dayKey, fmtCompact, fmtDayShort, fmtInt, fmtUsd, mcpServerLabel, parseDay } from '../lib/format.ts'
import { HEAT, levelOf, quartiles } from './heatmap/scale.tsx'
import { MARK_PATH } from './Mark.tsx'

export const CARD_W = 1200
export const CARD_H = 800
export const CARD_FONTS = ['Bricolage Grotesque Variable', 'IBM Plex Sans']

const DISPLAY = "'Bricolage Grotesque Variable', ui-sans-serif, system-ui, sans-serif"
const SANS = "'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif"
const PAD = 64
const INNER = CARD_W - PAD * 2
const MONTHS_LONG = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s)

/** "26,6 milyar" -> number part and word, so the word can be set smaller. */
function splitCompact(n: number): [string, string] {
  const s = fmtCompact(n)
  const i = s.indexOf(' ')
  return i > 0 ? [s.slice(0, i), s.slice(i + 1)] : [s, '']
}

export interface YearCardOptions {
  hideProjects: boolean
  hideCost: boolean
}

/**
 * The shareable year card, drawn as SVG at a fixed 1200 × 800 so the page and the PNG match.
 * Colors are theme variables; the PNG export writes in the current theme's values.
 */
export function YearCard({ data, options, ref }: { data: YearReport; options: YearCardOptions; ref?: Ref<SVGSVGElement> }) {
  const span = data.partial ? `1 Ocak – ${fmtDayShort(data.to)} ${data.year}` : `${data.year}`
  const [tokNum, tokWord] = splitCompact(data.totals.tokens)
  const stats: { value: string; unit?: string; label: string }[] = [
    { value: fmtInt(data.totals.messages), label: 'mesaj' },
    { value: fmtInt(data.activeDays), label: 'aktif gün' },
    { value: tokNum, label: `${tokWord ? `${tokWord} ` : ''}token` },
    options.hideCost
      ? { value: fmtInt(data.totals.sessions), label: 'oturum' }
      : { value: fmtUsd(data.totals.cost), label: 'tahmini maliyet' },
  ]
  const colW = INNER / 4

  return (
    <svg ref={ref} viewBox={`0 0 ${CARD_W} ${CARD_H}`} className="block h-auto w-full" role="img" aria-label={`${data.year} yıl özeti kartı`}>
      <rect width={CARD_W} height={CARD_H} fill="var(--surface)" />

      <g transform={`translate(${PAD} 57) scale(${26 / 424})`} fill="var(--ink)">
        <path fillRule="evenodd" d={MARK_PATH} />
      </g>
      <text x={PAD + 50} y={80} fontFamily={DISPLAY} fontSize={22} fontWeight={600} fill="var(--ink)" letterSpacing={-0.4}>
        Wiener Tools
      </text>
      <text x={CARD_W - PAD} y={80} textAnchor="end" fontFamily={SANS} fontSize={18} fill="var(--ink-3)">
        {span}
      </text>

      <text x={PAD} y={172} fontFamily={DISPLAY} fontSize={54} fontWeight={600} fill="var(--ink)" letterSpacing={-1.6}>
        Claude Code ile {data.year}
      </text>

      {stats.map((s, i) => (
        <g key={s.label} transform={`translate(${PAD + i * colW} 0)`}>
          <text y={266} fontFamily={DISPLAY} fontSize={50} fontWeight={600} fill="var(--ink)" letterSpacing={-1.2}>
            {s.value}
          </text>
          <text y={298} fontFamily={SANS} fontSize={17} fill="var(--ink-2)">
            {s.label}
          </text>
        </g>
      ))}

      <YearGrid data={data} y={338} />

      <line x1={PAD} x2={CARD_W - PAD} y1={548} y2={548} stroke="var(--line)" strokeWidth={1.5} />

      <Column
        x={PAD}
        title="EN ÇOK ÇALIŞILAN PROJELER"
        rows={data.projects.slice(0, 3).map((p, i) => [options.hideProjects ? `Proje ${i + 1}` : clip(p.name, 20), `${fmtInt(p.messages)}`])}
        rank
      />
      <Column x={PAD + INNER / 3} title="EN ÇOK KULLANILAN ARAÇLAR" rows={data.tools.slice(0, 3).map((t) => [clip(mcpServerLabel(t.name), 20), fmtInt(t.calls)])} rank />
      <Column
        x={PAD + (INNER / 3) * 2}
        title="RİTİM"
        rows={[
          ['En uzun seri', data.longestStreak ? `${data.longestStreak.days} gün` : '—'],
          ['En yoğun gün', data.busiestDay ? `${parseDay(data.busiestDay.day).getDate()} ${MONTHS_LONG[parseDay(data.busiestDay.day).getMonth()]}` : '—'],
          ['En verimli saat', data.peakHour !== null ? `${String(data.peakHour).padStart(2, '0')}.00` : '—'],
        ]}
      />

      <text x={PAD} y={CARD_H - 40} fontFamily={SANS} fontSize={15} fill="var(--ink-3)">
        npx wiener-tools-claude
      </text>
      <text x={CARD_W - PAD} y={CARD_H - 40} textAnchor="end" fontFamily={SANS} fontSize={15} fill="var(--ink-3)">
        +{fmtInt(data.totals.linesAdded)} satır · {fmtInt(data.totals.files)} dosya · {fmtInt(data.totals.prs)} PR
      </text>
    </svg>
  )
}

/** The year as a week-by-weekday grid, Monday on top, shaded by messages. */
function YearGrid({ data, y }: { data: YearReport; y: number }) {
  const { cells, months, cols } = useMemo(() => {
    const byDay = new Map(data.days.map((d) => [d.day, d.messages]))
    const t = quartiles(data.days.map((d) => d.messages))
    const first = parseDay(`${data.year}-01-01`)
    const offset = (first.getDay() + 6) % 7
    const cells: { col: number; row: number; fill: string; future: boolean }[] = []
    const months: { col: number; label: string }[] = []
    for (let d = new Date(first); d.getFullYear() === data.year; d.setDate(d.getDate() + 1)) {
      const key = dayKey(d)
      const index = offset + Math.round((d.getTime() - first.getTime()) / 86_400_000)
      const col = Math.floor(index / 7)
      if (d.getDate() === 1) months.push({ col: index % 7 === 0 ? col : col + 1, label: MONTHS_SHORT[d.getMonth()] ?? '' })
      cells.push({ col, row: index % 7, fill: HEAT[levelOf(byDay.get(key) ?? 0, t)] ?? HEAT[0], future: key > data.to })
    }
    return { cells, months, cols: Math.max(...cells.map((c) => c.col)) + 1 }
  }, [data])
  const step = INNER / cols
  const size = step - 4
  return (
    <g transform={`translate(${PAD} ${y})`}>
      {cells.map((c) => (
        <rect key={`${c.col}-${c.row}`} x={c.col * step} y={c.row * step} width={size} height={size} rx={3} fill={c.future ? 'var(--heat-0)' : c.fill} opacity={c.future ? 0.45 : 1} />
      ))}
      {months.map((m) => (
        <text key={m.label} x={m.col * step} y={7 * step + 20} fontFamily={SANS} fontSize={14} fill="var(--ink-3)">
          {m.label}
        </text>
      ))}
    </g>
  )
}

function Column({ x, title, rows, rank = false }: { x: number; title: string; rows: [string, string][]; rank?: boolean }) {
  const w = INNER / 3 - 40
  return (
    <g transform={`translate(${x} 0)`}>
      <text y={592} fontFamily={SANS} fontSize={13} fontWeight={600} fill="var(--ink-3)" letterSpacing={1.4}>
        {title}
      </text>
      {rows.map(([label, value], i) => (
        <g key={`${label}-${i}`}>
          {rank ? (
            <text y={632 + i * 36} fontFamily={SANS} fontSize={19} fill="var(--ink-3)">
              {i + 1}
            </text>
          ) : null}
          <text x={rank ? 24 : 0} y={632 + i * 36} fontFamily={SANS} fontSize={19} fill="var(--ink)">
            {label}
          </text>
          <text x={w} y={632 + i * 36} textAnchor="end" fontFamily={SANS} fontSize={19} fontWeight={600} fill="var(--ink)">
            {value}
          </text>
        </g>
      ))}
    </g>
  )
}

import { ArrowUpRight, CircleAlert, X } from 'lucide-react'
import { withPossessive } from '../../../shared/tr.ts'
import type { DayDetail, HeatmapResponse, HeatmapView, IndexStatus, Insight, Metric, PeriodTotals, RangeKey, Summary, TipsReport } from '../../../shared/types.ts'
import { Calendar } from '../components/heatmap/Calendar.tsx'
import { ProjectDay } from '../components/heatmap/ProjectDay.tsx'
import { WeekHour } from '../components/heatmap/WeekHour.tsx'
import { TipLinks } from '../components/TipLinks.tsx'
import { Card, CardHeader, Delta, ErrorNote, Segmented, Skeleton, cx } from '../components/ui.tsx'
import { useApi } from '../lib/api.ts'
import { fmtCompact, fmtCount, fmtDayLong, fmtDayShort, fmtDuration, fmtInt, fmtMetric, fmtRelative, fmtTime, fmtUsd, metricLabel, weekdays } from '../lib/format.ts'
import { tx } from '../lib/i18n.ts'
import { RangePicker, rangeLabel, rangeSpan, useRange } from '../lib/range.tsx'
import { navigate, onLinkClick, useLocation } from '../lib/router.ts'

const views = (): { value: HeatmapView; label: string; slug: string }[] => [
  { value: 'calendar', label: tx('Takvim', 'Calendar'), slug: 'takvim' },
  { value: 'weekhour', label: tx('Gün × saat', 'Day × hour'), slug: 'saat' },
  { value: 'project', label: tx('Proje × gün', 'Project × day'), slug: 'proje' },
]
const METRICS: { value: Metric; slug: string }[] = [
  { value: 'messages', slug: 'mesaj' },
  { value: 'tokens', slug: 'token' },
  { value: 'cost', slug: 'maliyet' },
  { value: 'sessions', slug: 'oturum' },
  { value: 'errors', slug: 'hata' },
]
/** The calendar always shows a year; the other two views follow the range picker. */
const spanFor = (view: HeatmapView, range: RangeKey) => (view === 'calendar' ? tx('Son 12 ayda', 'In the last 12 months') : rangeSpan(range))

/** The view, metric and selected day live in the URL, so back/forward and reloads keep them. */
function useOverviewState() {
  const { query } = useLocation()
  const view = views().find((v) => v.slug === query.get('gorunum'))?.value ?? 'calendar'
  const metric = METRICS.find((m) => m.slug === query.get('metrik'))?.value ?? 'messages'
  const day = /^\d{4}-\d{2}-\d{2}$/.test(query.get('gun') ?? '') ? query.get('gun') : null
  const set = (next: { view?: HeatmapView; metric?: Metric; day?: string | null }) => {
    const v = next.view ?? view
    const m = next.metric ?? metric
    const d = next.day === undefined ? day : next.day
    const q = new URLSearchParams()
    const donem = query.get('donem')
    if (donem && v !== 'calendar') q.set('donem', donem)
    if (v !== 'calendar') q.set('gorunum', views().find((x) => x.value === v)?.slug ?? '')
    if (m !== 'messages') q.set('metrik', METRICS.find((x) => x.value === m)?.slug ?? '')
    if (d && v !== 'weekhour') q.set('gun', d)
    navigate(q.size ? `/?${q}` : '/', { replace: true })
  }
  return { view, metric, day: view === 'weekhour' ? null : day, set }
}

export function Overview() {
  const { view, metric, day, set } = useOverviewState()
  const [range, setRange] = useRange('30d')
  const heatPath = `/api/heatmap?view=${view}&metric=${metric}${view === 'calendar' ? '' : `&range=${range}`}`
  const heatState = useApi<HeatmapResponse>(heatPath, { keepPrevious: true })
  // Keep the old grid while a new metric or range loads, but never draw it in another view's shape.
  const heat = heatState.data && heatState.data.view !== view ? { ...heatState, data: null } : heatState
  const summary = useApi<Summary>('/api/summary')
  const insights = useApi<Insight[]>('/api/insights')
  const status = useApi<IndexStatus>('/api/status')
  const firstIndex = status.data?.state === 'indexing' && status.data.lastScanAt === null

  return (
    <div className="mx-auto max-w-[1180px] space-y-6">
      <header className="space-y-2">
        <h1 className="font-display text-[34px] leading-[1.1] font-semibold tracking-[-0.03em] sm:text-[44px]">
          {heat.data ? <Headline data={heat.data} span={spanFor(view, range)} /> : <span className="text-ink-3">{spanFor(view, range)} …</span>}
        </h1>
        <p className="min-h-[1.5em] max-w-[70ch] text-[15px] text-ink-2">
          {firstIndex ? (
            tx('İlk indeksleme sürüyor; sayılar dosyalar okundukça tamamlanacak.', 'Indexing for the first time. The numbers will fill in as files are read.')
          ) : heat.data && summary.data ? (
            <Subline data={heat.data} summary={summary.data} />
          ) : (
            '\u00a0'
          )}
        </p>
      </header>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Segmented label={tx('Görünüm', 'View')} value={view} onChange={(v) => set({ view: v })} options={views()} />
            {view !== 'calendar' ? <RangePicker value={range} onChange={setRange} /> : null}
          </div>
          <Segmented
            label={tx('Metrik', 'Metric')}
            value={metric}
            onChange={(m) => set({ metric: m })}
            options={METRICS.map((m) => ({ value: m.value, label: metricLabel(m.value) }))}
          />
        </div>
        <div className={cx('px-5 py-5 transition-opacity', heat.stale && 'opacity-60')} aria-busy={heat.stale}>
          {heat.error ? (
            <ErrorNote message={heat.error} />
          ) : !heat.data ? (
            <Skeleton className="h-[170px] w-full" />
          ) : heat.data.total === 0 && metric === 'messages' && view === 'calendar' ? (
            <EmptyState />
          ) : view === 'calendar' ? (
            <Calendar data={heat.data} selected={day} onSelect={(d) => set({ day: d })} />
          ) : view === 'weekhour' ? (
            <WeekHour data={heat.data} />
          ) : (
            <ProjectDay data={heat.data} selected={day} onSelect={(d) => set({ day: d })} />
          )}
        </div>
        {day ? <DayLedger day={day} onClose={() => set({ day: null })} /> : null}
      </Card>

      {summary.data ? <StatStrip s={summary.data} /> : <Skeleton className="h-[88px] w-full" />}

      {summary.data?.periods ? <PeriodTable periods={summary.data.periods} /> : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title={tx('Bu hafta ne oldu', 'What happened this week')} />
          <ul className="px-5 pb-4">
            {insights.data?.length === 0 ? <li className="py-2 text-ink-2">{tx('Bu hafta söylenecek bir şey çıkacak kadar veri yok.', 'Not enough data yet to say anything about this week.')}</li> : null}
            {insights.data?.map((i) => (
              <li key={i.text} className="flex gap-3 border-t border-line py-2.5 first:border-t-0">
                <span
                  className={cx('mt-[7px] size-1.5 shrink-0 rounded-full', i.tone === 'warn' ? 'bg-danger' : i.tone === 'good' ? 'bg-good' : 'bg-ink-3')}
                  aria-hidden
                />
                {i.href ? (
                  <a href={i.href} onClick={(e) => onLinkClick(e, i.href as string)} className="group inline-flex flex-1 items-start justify-between gap-2 text-[14px]">
                    <span className="group-hover:underline group-hover:underline-offset-2">{i.text}</span>
                    <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-ink-3 group-hover:text-ink" aria-hidden />
                  </a>
                ) : (
                  <span className="text-[14px]">{i.text}</span>
                )}
              </li>
            ))}
          </ul>
        </Card>
        <LivePanel live={summary.data?.live ?? null} />
      </div>

      <TopTips />
    </div>
  )
}

function Headline({ data, span }: { data: HeatmapResponse; span: string }) {
  const value =
    data.metric === 'cost' ? tx(`${fmtUsd(data.total)} tahmini maliyet`, `${fmtUsd(data.total)} in estimated cost`) : fmtMetric(data.metric, data.total)
  return (
    <>
      <span className="text-ink-2">{span}{tx(' ', ', ')}</span>
      <span className="num">{value}</span>
    </>
  )
}

/** One sentence that reads the chart for you. */
function Subline({ data, summary }: { data: HeatmapResponse; summary: Summary }) {
  if (data.total === 0) return <>{tx('Bu aralıkta kayıt yok.', 'No activity in this range.')}</>
  const peak = data.cells.reduce((a, b) => (b.value > a.value ? b : a), data.cells[0] ?? { key: '', value: 0 })
  if (data.view === 'calendar') {
    const days = summary.streak.current
    const day = fmtDayShort(peak.key)
    const value = fmtMetric(data.metric, peak.value)
    return tx(
      <>En yoğun gün {day}: {value}.{days > 1 ? ` ${days} gündür her gün Claude ile çalıştın.` : ''}</>,
      <>Busiest day: {day}, with {value}.{days > 1 ? ` You've worked with Claude every day for the past ${days} days.` : ''}</>,
    )
  }
  if (data.view === 'weekhour') {
    const [dow, hour] = peak.key.split(':').map(Number) as [number, number]
    const weekend = data.cells.filter((c) => Number(c.key.split(':')[0]) >= 5).reduce((s, c) => s + c.value, 0)
    const share = Math.round((weekend / data.total) * 100)
    const time = `${String(hour).padStart(2, '0')}:00`
    return tx(
      <>
        En yoğun saat {weekdays()[dow]} {time}. Hafta sonunun payı %{share}.
      </>,
      <>
        Busiest hour: {weekdays()[dow]}s at {time}. Weekends account for {share}%.
      </>,
    )
  }
  const top = data.projects[0]
  if (!top) return null
  const value = fmtMetric(data.metric, top.total)
  const share = (top.total / data.total) * 100
  return tx(
    <>
      En çok {top.name}: {value}
      {data.metric !== 'sessions' ? `, toplamın ${withPossessive(share, '%')}` : ''}.
    </>,
    <>
      Top project: {top.name}, with {value}
      {data.metric !== 'sessions' ? ` (${Math.round(share)}% of the total)` : ''}.
    </>,
  )
}

function StatStrip({ s }: { s: Summary }) {
  const busy = s.live.filter((l) => l.status === 'busy').length
  const items = [
    {
      label: tx('Bugün', 'Today'),
      value: fmtCount(s.today.messages, 'mesaj', 'message'),
      note:
        s.today.yesterdayMessages > 0 ? (
          <><Delta now={s.today.messages} before={s.today.yesterdayMessages} /> {tx('dünden', 'vs. yesterday')}</>
        ) : (
          tx('dün kayıt yok', 'no activity yesterday')
        ),
    },
    {
      label: tx('Bu hafta', 'This week'),
      value: fmtUsd(s.week.cost),
      note:
        s.week.lastWeekCost > 0 ? (
          <><Delta now={s.week.cost} before={s.week.lastWeekCost} invert /> {tx('geçen haftanın aynı günlerine göre', 'vs. the same days last week')}</>
        ) : (
          tx('tahmini maliyet', 'estimated cost')
        ),
    },
    {
      label: tx('Açık oturum', 'Open sessions'),
      value: fmtInt(s.live.length),
      note: s.live.length ? tx(`${busy} tanesi şu an çalışıyor`, `${busy} working right now`) : tx('şu an çalışan yok', 'none working right now'),
    },
    {
      label: tx('Seri', 'Streak'),
      value: fmtCount(s.streak.current, 'gün', 'day'),
      note: tx(`en uzunu ${s.streak.longest} gün`, `longest: ${fmtCount(s.streak.longest, 'gün', 'day')}`),
    },
  ]
  return (
    <dl className="grid grid-cols-2 overflow-hidden rounded-xl border border-line bg-surface lg:grid-cols-4">
      {items.map((it, i) => (
        <div key={it.label} className={cx('px-5 py-4', i % 2 === 1 && 'border-l border-line', i >= 2 && 'border-t border-line lg:border-t-0', i === 2 && 'lg:border-l')}>
          <dt className="text-[12px] text-ink-3">{it.label}</dt>
          <dd className="mt-0.5 font-display text-[26px] leading-tight font-semibold tracking-[-0.02em] num">{it.value}</dd>
          <dd className="mt-0.5 text-[12px] text-ink-2">{it.note}</dd>
        </div>
      ))}
    </dl>
  )
}

/** The two tips with the most at stake over the last 30 days. */
function TopTips() {
  const { data } = useApi<TipsReport>('/api/tips?range=30d', { keepPrevious: true })
  if (!data || data.tips.length === 0) return null
  return (
    <Card>
      <CardHeader
        title={tx('İpuçları', 'Tips')}
        aside={
          <a href="/ipuclari" onClick={(e) => onLinkClick(e, '/ipuclari')} className="text-accent hover:underline hover:underline-offset-2">
            {data.tips.length > 2 ? tx(`${data.tips.length} ipucunun hepsi`, `All ${data.tips.length} tips`) : tx('İpuçları sayfası', 'Tips page')}
          </a>
        }
      />
      <TipLinks tips={data.tips.slice(0, 2)} range="30d" empty="" />
    </Card>
  )
}

/** Messages, tokens by kind and cost for the three ranges side by side. */
function PeriodTable({ periods }: { periods: PeriodTotals[] }) {
  const total = (p: PeriodTotals) => p.input + p.output + p.cacheRead + p.cacheWrite
  const rows: { label: string; value: (p: PeriodTotals) => number; format: (v: number) => string; strong?: boolean; sub?: boolean }[] = [
    { label: tx('Mesaj', 'Messages'), value: (p) => p.messages, format: fmtInt },
    { label: tx('Toplam token', 'Total tokens'), value: total, format: fmtCompact, strong: true },
    { label: tx("Cache'ten okuma", 'Cache reads'), value: (p) => p.cacheRead, format: fmtCompact, sub: true },
    { label: tx("Cache'e yazma", 'Cache writes'), value: (p) => p.cacheWrite, format: fmtCompact, sub: true },
    { label: 'Output', value: (p) => p.output, format: fmtCompact, sub: true },
    { label: 'Input', value: (p) => p.input, format: fmtCompact, sub: true },
    { label: tx('Tahmini maliyet', 'Estimated cost'), value: (p) => p.cost, format: fmtUsd },
  ]
  return (
    <Card>
      <CardHeader title={tx('Dönem özeti', 'Totals by period')} aside={tx('mesaj, token ve maliyet', 'messages, tokens and cost')} />
      <div className="overflow-x-auto px-4 pb-2 sm:px-5">
        <table className="w-full min-w-[300px] table-fixed text-[12px] sm:text-[13px]">
          <colgroup>
            <col className="w-[27%] sm:w-[38%]" />
            <col />
            <col />
            <col />
          </colgroup>
          <thead>
            <tr className="text-[12px] text-ink-3">
              <th className="sticky left-0 bg-surface pb-2 text-left font-normal" />
              {periods.map((p) => (
                <th key={p.key} className="pb-2 text-right font-normal">{rangeLabel(p.key)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className={cx('*:border-t *:border-line', r.strong && 'font-medium')}>
                <td className={cx('sticky left-0 bg-surface py-1.5 pr-2 leading-snug', r.sub ? 'pl-2 text-ink-2 sm:pl-3' : 'text-ink')}>{r.label}</td>
                {periods.map((p) => {
                  const v = r.value(p)
                  return (
                    <td key={p.key} className="py-1.5 pl-2 text-right num" title={fmtInt(v)}>
                      {r.format(v)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-4 pb-4 text-[12px] text-ink-3 sm:px-5">
        {tx(
          `Toplam, Claude'un her istekte konuşmayı cache'ten yeniden okumasını da sayar; bu yüzden çok büyüktür. Claude'un yazdığı metin "Output" satırıdır. Tam sayı için üzerine gel.`,
          `The total includes Claude rereading the conversation from cache on every request, which is why it's so large. The text Claude writes is the "Output" row. Hover over a value for the exact number.`,
        )}
      </p>
    </Card>
  )
}

function DayLedger({ day, onClose }: { day: string; onClose: () => void }) {
  const { data, error } = useApi<DayDetail>(`/api/day/${day}`)
  return (
    <div className="border-t border-line bg-raised px-5 py-4" aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">{fmtDayLong(day)}</h2>
          {data ? (
            <p className="text-[13px] text-ink-2 num">
              {fmtCount(data.sessions.length, 'oturum', 'session')} · {fmtCount(data.messages, 'mesaj', 'message')} · {fmtUsd(data.cost)}
            </p>
          ) : null}
        </div>
        <button type="button" onClick={onClose} aria-label={tx('Günü kapat', 'Close day details')} className="rounded-md p-1 text-ink-3 hover:bg-line/50 hover:text-ink">
          <X className="size-4" />
        </button>
      </div>
      {error ? <div className="mt-3"><ErrorNote message={error} /></div> : null}
      {data && data.sessions.length === 0 ? <p className="mt-3 text-[13px] text-ink-2">{tx('Bu gün Claude ile çalışılmamış.', "You didn't work with Claude on this day.")}</p> : null}
      {data && data.sessions.length > 0 ? (
        <ul className="mt-3">
          {data.sessions.map((s) => (
            <li key={s.id} className="border-t border-line first:border-t-0">
              <a
                href={`/oturumlar/${s.id}`}
                onClick={(e) => onLinkClick(e, `/oturumlar/${s.id}`)}
                className="group grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-baseline gap-3 py-2.5"
              >
                <span className="font-mono text-[12px] text-ink-3 num">
                  {fmtTime(s.firstTs)}–{fmtTime(s.lastTs)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate group-hover:underline group-hover:underline-offset-2">{s.title}</span>
                  <span className="text-[12px] text-ink-3">{s.projectName}</span>
                </span>
                <span className="text-right font-mono text-[12px] text-ink-2 num">
                  {fmtCount(s.messages, 'mesaj', 'message')} · {fmtUsd(s.cost)}
                  {s.errors > 0 ? <span className="ml-2 text-danger">{fmtCount(s.errors, 'hata', 'error')}</span> : null}
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function LivePanel({ live }: { live: Summary['live'] | null }) {
  return (
    <Card>
      <CardHeader title={tx('Şu an açık', 'Open now')} aside={live ? fmtCount(live.length, 'oturum', 'session') : null} />
      <ul className="px-5 pb-4">
        {live === null ? <li><Skeleton className="h-10 w-full" /></li> : null}
        {live?.length === 0 ? <li className="py-2 text-ink-2">{tx('Açık bir Claude Code oturumu yok.', 'No Claude Code sessions are open.')}</li> : null}
        {live?.map((l) => (
          <li key={l.sessionId} className="border-t border-line first:border-t-0">
            <a
              href={`/oturumlar/${l.sessionId}`}
              onClick={(e) => onLinkClick(e, `/oturumlar/${l.sessionId}`)}
              className="group flex items-center gap-3 py-2.5"
            >
              <span
                className={cx('size-2 shrink-0 rounded-full', l.status === 'busy' ? 'bg-good' : 'bg-ink-3/50')}
                aria-label={l.status === 'busy' ? tx('çalışıyor', 'working') : tx('bekliyor', 'waiting')}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate group-hover:underline group-hover:underline-offset-2">{l.title ?? tx('Adsız oturum', 'Untitled session')}</span>
                <span className="text-[12px] text-ink-3">
                  {l.projectName ?? tx('Bilinmeyen proje', 'Unknown project')} · {l.status === 'busy' ? tx('çalışıyor', 'working') : tx('bekliyor', 'waiting')}
                  {l.updatedAt ? ` · ${fmtRelative(l.updatedAt)}` : ''}
                </span>
              </span>
              <ArrowUpRight className="size-4 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
            </a>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <CircleAlert className="size-5 text-ink-3" aria-hidden />
      <p className="font-medium">{tx('Henüz Claude Code oturumu bulunamadı', 'No Claude Code sessions found yet')}</p>
      <p className="max-w-[48ch] text-[13px] text-ink-2">
        {tx(
          <>
            Wiener Lens <code className="font-mono">~/.claude/projects</code> klasörünü okur. İlk oturumundan sonra burası kendiliğinden dolacak.
            Başka bir profil kullanıyorsan <code className="font-mono">CLAUDE_CONFIG_DIR</code> ile başlat.
          </>,
          <>
            Wiener Lens reads the <code className="font-mono">~/.claude/projects</code> folder. This page fills in on its own after your first session.
            If you use a different profile, set <code className="font-mono">CLAUDE_CONFIG_DIR</code> when you start it.
          </>,
        )}
      </p>
    </div>
  )
}

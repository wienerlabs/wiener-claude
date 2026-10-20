import { ArrowUpRight, CircleAlert, X } from 'lucide-react'
import { withPossessive } from '../../../shared/tr.ts'
import type { DayDetail, HeatmapResponse, HeatmapView, IndexStatus, Insight, Metric, Summary } from '../../../shared/types.ts'
import { Calendar } from '../components/heatmap/Calendar.tsx'
import { ProjectDay } from '../components/heatmap/ProjectDay.tsx'
import { WeekHour } from '../components/heatmap/WeekHour.tsx'
import { Card, CardHeader, Delta, ErrorNote, Segmented, Skeleton, cx } from '../components/ui.tsx'
import { useApi } from '../lib/api.ts'
import {
  METRIC_LABEL, WEEKDAYS, fmtDayLong, fmtDayShort, fmtDuration, fmtInt, fmtMetric, fmtRelative, fmtTime, fmtUsd,
} from '../lib/format.ts'
import { navigate, onLinkClick, useLocation } from '../lib/router.ts'

const VIEWS: { value: HeatmapView; label: string; slug: string }[] = [
  { value: 'calendar', label: 'Takvim', slug: 'takvim' },
  { value: 'weekhour', label: 'Gün × saat', slug: 'saat' },
  { value: 'project', label: 'Proje × gün', slug: 'proje' },
]
const METRICS: { value: Metric; slug: string }[] = [
  { value: 'messages', slug: 'mesaj' },
  { value: 'tokens', slug: 'token' },
  { value: 'cost', slug: 'maliyet' },
  { value: 'sessions', slug: 'oturum' },
  { value: 'errors', slug: 'hata' },
]
const SPAN: Record<HeatmapView, string> = { calendar: 'Son 12 ayda', weekhour: 'Son 90 günde', project: 'Son 30 günde' }

/** The view, metric and selected day live in the URL, so back/forward and reloads keep them. */
function useOverviewState() {
  const { query } = useLocation()
  const view = VIEWS.find((v) => v.slug === query.get('gorunum'))?.value ?? 'calendar'
  const metric = METRICS.find((m) => m.slug === query.get('metrik'))?.value ?? 'messages'
  const day = /^\d{4}-\d{2}-\d{2}$/.test(query.get('gun') ?? '') ? query.get('gun') : null
  const set = (next: { view?: HeatmapView; metric?: Metric; day?: string | null }) => {
    const v = next.view ?? view
    const m = next.metric ?? metric
    const d = next.day === undefined ? day : next.day
    const q = new URLSearchParams()
    if (v !== 'calendar') q.set('gorunum', VIEWS.find((x) => x.value === v)?.slug ?? '')
    if (m !== 'messages') q.set('metrik', METRICS.find((x) => x.value === m)?.slug ?? '')
    if (d && v !== 'weekhour') q.set('gun', d)
    navigate(q.size ? `/?${q}` : '/', { replace: true })
  }
  return { view, metric, day: view === 'weekhour' ? null : day, set }
}

export function Overview() {
  const { view, metric, day, set } = useOverviewState()
  const heat = useApi<HeatmapResponse>(`/api/heatmap?view=${view}&metric=${metric}`)
  const summary = useApi<Summary>('/api/summary')
  const insights = useApi<Insight[]>('/api/insights')
  const status = useApi<IndexStatus>('/api/status')
  const firstIndex = status.data?.state === 'indexing' && status.data.lastScanAt === null

  return (
    <div className="mx-auto max-w-[1180px] space-y-6">
      <header className="space-y-2">
        <h1 className="font-display text-[34px] leading-[1.1] font-semibold tracking-[-0.03em] sm:text-[44px]">
          {heat.data ? <Headline data={heat.data} /> : <span className="text-ink-3">{SPAN[view]} …</span>}
        </h1>
        <p className="min-h-[1.5em] max-w-[70ch] text-[15px] text-ink-2">
          {firstIndex ? (
            'İlk indeksleme sürüyor; sayılar dosyalar okundukça tamamlanacak.'
          ) : heat.data && summary.data ? (
            <Subline data={heat.data} summary={summary.data} />
          ) : (
            '\u00a0'
          )}
        </p>
      </header>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
          <Segmented label="Görünüm" value={view} onChange={(v) => set({ view: v })} options={VIEWS} />
          <Segmented
            label="Metrik"
            value={metric}
            onChange={(m) => set({ metric: m })}
            options={METRICS.map((m) => ({ value: m.value, label: METRIC_LABEL[m.value] }))}
          />
        </div>
        <div className="px-5 py-5">
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

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Bu hafta ne oldu" />
          <ul className="px-5 pb-4">
            {insights.data?.length === 0 ? <li className="py-2 text-ink-2">Bu hafta söylenecek bir şey çıkacak kadar veri yok.</li> : null}
            {insights.data?.map((i) => (
              <li key={i.text} className="flex gap-3 border-t border-line py-2.5 first:border-t-0">
                <span
                  className={cx('mt-[7px] size-1.5 shrink-0 rounded-full', i.tone === 'warn' ? 'bg-danger' : i.tone === 'good' ? 'bg-good' : 'bg-ink-3')}
                  aria-hidden
                />
                <span className="text-[14px]">{i.text}</span>
              </li>
            ))}
          </ul>
        </Card>
        <LivePanel live={summary.data?.live ?? null} />
      </div>
    </div>
  )
}

function Headline({ data }: { data: HeatmapResponse }) {
  const value =
    data.metric === 'cost' ? `${fmtUsd(data.total)} tahmini maliyet` : fmtMetric(data.metric, data.total)
  return (
    <>
      <span className="text-ink-2">{SPAN[data.view]} </span>
      <span className="num">{value}</span>
    </>
  )
}

/** One sentence that reads the chart for you. */
function Subline({ data, summary }: { data: HeatmapResponse; summary: Summary }) {
  if (data.total === 0) return <>Bu aralıkta kayıt yok.</>
  const peak = data.cells.reduce((a, b) => (b.value > a.value ? b : a), data.cells[0] ?? { key: '', value: 0 })
  if (data.view === 'calendar') {
    const streak = summary.streak.current > 1 ? ` ${summary.streak.current} gündür her gün Claude ile çalıştın.` : ''
    return <>En yoğun gün {fmtDayShort(peak.key)}: {fmtMetric(data.metric, peak.value)}.{streak}</>
  }
  if (data.view === 'weekhour') {
    const [dow, hour] = peak.key.split(':').map(Number) as [number, number]
    const weekend = data.cells.filter((c) => Number(c.key.split(':')[0]) >= 5).reduce((s, c) => s + c.value, 0)
    const share = Math.round((weekend / data.total) * 100)
    return (
      <>
        En yoğun saat {WEEKDAYS[dow]} {String(hour).padStart(2, '0')}:00. Hafta sonunun payı %{share}.
      </>
    )
  }
  const top = data.projects[0]
  if (!top) return null
  return (
    <>
      En çok {top.name}: {fmtMetric(data.metric, top.total)}
      {data.metric !== 'sessions' ? `, toplamın ${withPossessive((top.total / data.total) * 100, '%')}` : ''}.
    </>
  )
}

function StatStrip({ s }: { s: Summary }) {
  const items = [
    {
      label: 'Bugün',
      value: `${fmtInt(s.today.messages)} mesaj`,
      note: s.today.yesterdayMessages > 0 ? <><Delta now={s.today.messages} before={s.today.yesterdayMessages} /> dünden</> : 'dün kayıt yok',
    },
    {
      label: 'Bu hafta',
      value: fmtUsd(s.week.cost),
      note: s.week.lastWeekCost > 0 ? <><Delta now={s.week.cost} before={s.week.lastWeekCost} invert /> geçen haftanın aynı günlerine göre</> : 'tahmini maliyet',
    },
    {
      label: 'Açık oturum',
      value: fmtInt(s.live.length),
      note: s.live.length ? `${s.live.filter((l) => l.status === 'busy').length} tanesi şu an çalışıyor` : 'şu an çalışan yok',
    },
    {
      label: 'Seri',
      value: `${s.streak.current} gün`,
      note: `en uzunu ${s.streak.longest} gün`,
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

function DayLedger({ day, onClose }: { day: string; onClose: () => void }) {
  const { data, error } = useApi<DayDetail>(`/api/day/${day}`)
  return (
    <div className="border-t border-line bg-raised px-5 py-4" aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">{fmtDayLong(day)}</h2>
          {data ? (
            <p className="text-[13px] text-ink-2 num">
              {data.sessions.length} oturum · {fmtInt(data.messages)} mesaj · {fmtUsd(data.cost)}
            </p>
          ) : null}
        </div>
        <button type="button" onClick={onClose} aria-label="Günü kapat" className="rounded-md p-1 text-ink-3 hover:bg-line/50 hover:text-ink">
          <X className="size-4" />
        </button>
      </div>
      {error ? <div className="mt-3"><ErrorNote message={error} /></div> : null}
      {data && data.sessions.length === 0 ? <p className="mt-3 text-[13px] text-ink-2">Bu gün Claude ile çalışılmamış.</p> : null}
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
                  {fmtInt(s.messages)} mesaj · {fmtUsd(s.cost)}
                  {s.errors > 0 ? <span className="ml-2 text-danger">{s.errors} hata</span> : null}
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
      <CardHeader title="Şu an açık" aside={live ? `${live.length} oturum` : null} />
      <ul className="px-5 pb-4">
        {live === null ? <li><Skeleton className="h-10 w-full" /></li> : null}
        {live?.length === 0 ? <li className="py-2 text-ink-2">Açık bir Claude Code oturumu yok.</li> : null}
        {live?.map((l) => (
          <li key={l.sessionId} className="border-t border-line first:border-t-0">
            <a
              href={`/oturumlar/${l.sessionId}`}
              onClick={(e) => onLinkClick(e, `/oturumlar/${l.sessionId}`)}
              className="group flex items-center gap-3 py-2.5"
            >
              <span
                className={cx('size-2 shrink-0 rounded-full', l.status === 'busy' ? 'bg-good' : 'bg-ink-3/50')}
                aria-label={l.status === 'busy' ? 'çalışıyor' : 'bekliyor'}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate group-hover:underline group-hover:underline-offset-2">{l.title ?? 'Adsız oturum'}</span>
                <span className="text-[12px] text-ink-3">
                  {l.projectName ?? 'Bilinmeyen proje'} · {l.status === 'busy' ? 'çalışıyor' : 'bekliyor'}
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
      <p className="font-medium">Henüz Claude Code oturumu bulunamadı</p>
      <p className="max-w-[48ch] text-[13px] text-ink-2">
        Wiener Tools <code className="font-mono">~/.claude/projects</code> klasörünü okur. İlk oturumundan sonra burası kendiliğinden dolacak.
        Başka bir profil kullanıyorsan <code className="font-mono">CLAUDE_CONFIG_DIR</code> ile başlat.
      </p>
    </div>
  )
}

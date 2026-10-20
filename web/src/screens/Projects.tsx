import { ArrowLeft, ArrowRight, FileCode2, GitPullRequest } from 'lucide-react'
import { useState } from 'react'
import type { HeatmapResponse, Metric, ProjectDetail, ProjectSummary, RangeKey } from '../../../shared/types.ts'
import { HBars, MiniStrip } from '../components/charts.tsx'
import { Calendar } from '../components/heatmap/Calendar.tsx'
import { Card, CardHeader, ErrorNote, Segmented, Skeleton, cx } from '../components/ui.tsx'
import { useApi } from '../lib/api.ts'
import { METRIC_LABEL, fmtDateTime, fmtInt, fmtRelative, fmtUsd, modelName } from '../lib/format.ts'
import { RangePicker, useRange } from '../lib/range.tsx'
import { onLinkClick } from '../lib/router.ts'

const RANGE_LOWER: Record<RangeKey, string> = { week: 'bu hafta', '30d': 'son 30 günde', all: 'toplam' }
/** Links keep the selected range, so the detail page opens on the same period. */
const withRange = (path: string, range: RangeKey) => (range === '30d' ? path : `${path}${path.includes('?') ? '&' : '?'}donem=${range === 'week' ? 'hafta' : 'tum'}`)
const projectHref = (key: string, range: RangeKey) => withRange(`/projeler/${encodeURIComponent(key)}`, range)

export function Projects({ selectedKey }: { selectedKey: string | null }) {
  return selectedKey ? <ProjectPage projectKey={selectedKey} /> : <ProjectList />
}

function ProjectList() {
  const [range, setRange] = useRange('30d')
  const { data, error, stale } = useApi<ProjectSummary[]>(`/api/projects?range=${range}`, { keepPrevious: true })
  return (
    <div className="mx-auto max-w-[1180px] space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
        <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em]">Projeler</h1>
        <p className="text-[14px] text-ink-2">Worktree'ler kendi repolarına sayılır. Klasör seçmeden açılan Desktop oturumları tek satırda toplanır.</p>
        </div>
        <RangePicker value={range} onChange={setRange} />
      </header>
      {error ? <ErrorNote message={error} /> : null}
      {!data && !error ? <div className="space-y-2">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div> : null}
      {data?.length === 0 ? <p className="text-ink-2">{range === 'all' ? 'Henüz bir proje yok.' : 'Bu dönemde etkinliği olan proje yok.'}</p> : null}
      {data && data.length > 0 ? (
        <ul className={cx('overflow-hidden rounded-xl border border-line bg-surface transition-opacity', stale && 'opacity-60')} aria-busy={stale}>
          {data.map((p) => (
            <li key={p.key} className="border-t border-line first:border-t-0">
              <a
                href={projectHref(p.key, range)}
                onClick={(e) => onLinkClick(e, projectHref(p.key, range))}
                className="grid gap-x-6 gap-y-2 px-5 py-4 transition-colors hover:bg-raised sm:grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1.3fr)_auto_minmax(0,1fr)]"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-medium">{p.name}</span>
                  <span className="block truncate font-mono text-[12px] text-ink-3">{p.path ? p.path.replace(/^\/Users\/[^/]+/, '~') : 'farklı klasörler'}</span>
                  <span className="mt-1 block text-[12px] text-ink-2 num">
                    {RANGE_LOWER[range]} {fmtInt(range === 'all' ? p.sessions : p.rangeSessions)} oturum, {fmtInt(p.rangeMessages)} mesaj, {fmtUsd(p.rangeCost)} · son etkinlik {fmtRelative(p.lastTs)}
                  </span>
                </span>
                <span className="self-center">
                  <MiniStrip values={p.strip} label={`${p.name}: son 12 haftanın günlük mesajları`} />
                </span>
                <span className="hidden min-w-0 self-center lg:block">
                  {p.topFiles.length ? (
                    <span className="block space-y-0.5">
                      {p.topFiles.map((f) => (
                        <span key={f} className="block truncate font-mono text-[12px] text-ink-2" title={f}>{f}</span>
                      ))}
                    </span>
                  ) : (
                    <span className="text-[12px] text-ink-3">Dosya değişikliği yok</span>
                  )}
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

const METRICS: Metric[] = ['messages', 'cost', 'tokens', 'sessions', 'errors']

function ProjectPage({ projectKey }: { projectKey: string }) {
  const [range, setRange] = useRange('30d')
  // Keep the page on a range change; a different project starts clean.
  const detail = useApi<ProjectDetail>(`/api/projects/${encodeURIComponent(projectKey)}?range=${range}`, { keepPrevious: true })
  const sameProject = detail.data?.key === projectKey
  const data = sameProject ? detail.data : null
  const error = detail.error
  const stale = detail.stale
  const [metric, setMetric] = useState<Metric>('messages')
  const heat = useApi<HeatmapResponse>(`/api/heatmap?view=calendar&metric=${metric}&project=${encodeURIComponent(projectKey)}`)

  return (
    <div className="mx-auto max-w-[1180px] space-y-6">
      <a href={withRange('/projeler', range)} onClick={(e) => onLinkClick(e, withRange('/projeler', range))} className="inline-flex items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Bütün projeler
      </a>
      {error ? <ErrorNote message={error} /> : null}
      {!data && !error ? <Skeleton className="h-28 w-full" /> : null}
      {data ? (
        <div className={cx('space-y-6 transition-opacity', stale && 'opacity-60')} aria-busy={stale}>
          <header className="flex flex-wrap items-end justify-between gap-3">
            <div className="space-y-1">
            <h1 className="font-display text-[34px] leading-tight font-semibold tracking-[-0.03em]">{data.name}</h1>
            {data.path ? <p className="font-mono text-[12px] text-ink-3">{data.path.replace(/^\/Users\/[^/]+/, '~')}</p> : null}
            </div>
            <RangePicker value={range} onChange={setRange} />
          </header>

          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line max-sm:[&>*:last-child]:col-span-2 sm:grid-cols-5">
            <Stat
              label="Oturum"
              value={fmtInt(range === 'all' ? data.sessions : data.rangeSessions)}
              note={range === 'all' ? `${fmtDateTime(data.firstTs)} başladı` : `toplam ${fmtInt(data.sessions)}`}
            />
            <Stat label="Mesaj" value={fmtInt(data.messages)} note={`${fmtInt(data.prompts)} istem`} />
            <Stat label="Maliyet" value={fmtUsd(data.rangeCost)} note={range === 'all' ? 'tahmini liste fiyatı' : `toplam ${fmtUsd(data.cost)}`} />
            <Stat
              label="Değişen satır"
              value={`+${fmtInt(data.linesAdded)}`}
              note={<span className="text-danger">−{fmtInt(data.linesRemoved)}</span>}
            />
            <Stat label="Araç çağrısı" value={fmtInt(data.toolCalls)} note={data.toolErrors ? <span className="text-danger">{fmtInt(data.toolErrors)} hata</span> : 'hatasız'} />
          </dl>

          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
              <h2 className="text-[13px] font-medium">Son 12 ay</h2>
              <Segmented label="Metrik" value={metric} onChange={setMetric} options={METRICS.map((m) => ({ value: m, label: METRIC_LABEL[m] }))} />
            </div>
            <div className="px-5 py-5">
              {heat.data ? <Calendar data={heat.data} hint="Bu projedeki günlük etkinlik." /> : <Skeleton className="h-[170px] w-full" />}
            </div>
          </Card>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <Card>
              <CardHeader title="En çok değişen dosyalar" aside={`${RANGE_LOWER[range]}, Edit, Write ve kabuk düzenlemeleri`} />
              {data.files.length === 0 ? (
                <p className="px-5 pb-5 text-ink-2">Bu dönemde kayıtlı dosya değişikliği yok.</p>
              ) : (
                <div className="overflow-x-auto px-5 pb-4">
                  <table className="w-full min-w-[520px] table-fixed text-[13px]">
                    <colgroup>
                      <col />
                      <col className="w-[7.5rem]" />
                      <col className="w-[8.5rem]" />
                      <col className="w-[6.5rem]" />
                    </colgroup>
                    <thead>
                      <tr className="text-left text-[12px] text-ink-3">
                        <th className="pb-2 font-normal">Dosya</th>
                        <th className="pb-2 text-right font-normal">Düzenleme</th>
                        <th className="pb-2 text-right font-normal">Satır</th>
                        <th className="pb-2 text-right font-normal">Son</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.files.map((f) => (
                        <tr key={f.path} className="border-t border-line">
                          <td className="py-1.5 pr-3">
                            <FilePath path={f.path} />
                          </td>
                          <td className="py-1.5 text-right font-mono text-[12px] num">
                            {f.edits}
                            {f.sessions > 1 ? <span className="text-ink-3"> · {f.sessions} oturum</span> : null}
                          </td>
                          <td className="py-1.5 text-right font-mono text-[12px] whitespace-nowrap num">
                            <span className="text-good">+{fmtInt(f.added)}</span> <span className="text-danger">−{fmtInt(f.removed)}</span>
                          </td>
                          <td className="py-1.5 pl-3 text-right text-[12px] whitespace-nowrap text-ink-3">{fmtRelative(f.lastTs)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <div className="space-y-6">
              <Card>
                <CardHeader title="Araçlar" aside={`${RANGE_LOWER[range]}, en çok kullanılanlar`} />
                <div className="px-5 pb-5">
                  <HBars
                    format={fmtInt}
                    items={data.tools.map((t) => ({
                      label: t.name.startsWith('mcp__') ? t.name.split('__').slice(1).join(' › ') : t.name,
                      value: t.calls,
                      note: t.errors ? `${t.errors} hata` : undefined,
                    }))}
                  />
                </div>
              </Card>
              <Card>
                <CardHeader title="Modeller" aside={RANGE_LOWER[range]} />
                <div className="px-5 pb-5">
                  <HBars format={fmtUsd} items={data.models.map((m) => ({ label: modelName(m.model), value: m.cost }))} />
                </div>
              </Card>
            </div>
          </div>

          <Card>
            <CardHeader title="Açılan PR'lar" aside={data.prs.length ? `${data.prs.length} PR` : null} />
            {data.prs.length === 0 ? (
              <p className="px-5 pb-5 text-ink-2">Bu dönemde açılmış bir PR kaydı yok.</p>
            ) : (
              <ul className="px-5 pb-4">
                {data.prs.map((pr) => (
                  <li key={pr.url} className="flex flex-wrap items-baseline gap-x-3 border-t border-line py-2 first:border-t-0">
                    <a href={pr.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[12px] text-accent underline underline-offset-2">
                      <GitPullRequest className="size-3.5" aria-hidden />
                      {pr.repo ? `${pr.repo}#${pr.number ?? ''}` : `#${pr.number ?? ''}`}
                    </a>
                    <a
                      href={`/oturumlar/${pr.sessionId}`}
                      onClick={(e) => onLinkClick(e, `/oturumlar/${pr.sessionId}`)}
                      className="min-w-0 flex-1 truncate text-[13px] hover:underline hover:underline-offset-2"
                    >
                      {pr.title}
                    </a>
                    <span className="text-[12px] text-ink-3">{fmtRelative(pr.ts)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <a
            href={withRange(`/oturumlar?proje=${encodeURIComponent(data.key)}`, range)}
            onClick={(e) => onLinkClick(e, withRange(`/oturumlar?proje=${encodeURIComponent(data.key)}`, range))}
            className="inline-flex items-center gap-1.5 text-[14px] text-accent underline underline-offset-2"
          >
            Bu projenin {RANGE_LOWER[range] === 'toplam' ? '' : `${RANGE_LOWER[range]} `}{fmtInt(range === 'all' ? data.sessions : data.rangeSessions)} oturumu <ArrowRight className="size-4" aria-hidden />
          </a>
        </div>
      ) : null}
    </div>
  )
}

function Stat({ label, value, note }: { label: string; value: string; note: React.ReactNode }) {
  return (
    <div className="bg-surface px-5 py-4">
      <dt className="text-[12px] text-ink-3">{label}</dt>
      <dd className="mt-0.5 font-display text-[22px] leading-tight font-semibold tracking-[-0.02em] num">{value}</dd>
      <dd className="mt-0.5 text-[12px] text-ink-2">{note}</dd>
    </div>
  )
}

/** Folder and file name; when space runs out the folder shrinks and the name stays whole. */
function FilePath({ path }: { path: string }) {
  const cut = path.lastIndexOf('/')
  const dir = cut >= 0 ? path.slice(0, cut + 1) : ''
  const base = cut >= 0 ? path.slice(cut + 1) : path
  return (
    <span className="flex min-w-0 items-center gap-1.5 font-mono text-[12px]" title={path}>
      <FileCode2 className="size-3.5 shrink-0 text-ink-3" aria-hidden />
      <span className="min-w-0 truncate text-ink-3">{dir}</span>
      <span className="-ml-1.5 shrink-0 text-ink">{base}</span>
    </span>
  )
}

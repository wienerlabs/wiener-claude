import type { FeatureKey, RangeKey, ToolCategory, ToolsReport, UsageStat } from '../../../shared/types.ts'
import { withPossessive } from '../../../shared/tr.ts'
import { ShareBar } from '../components/charts.tsx'
import { Card, CardHeader, ErrorNote, Skeleton, cx } from '../components/ui.tsx'
import { useApi } from '../lib/api.ts'
import { fmtDateTime, fmtInt, fmtRelative, fmtUsd, mcpServerLabel } from '../lib/format.ts'
import { RangePicker, rangeSpan, useRange } from '../lib/range.tsx'

const RANGE_LOWER: Record<RangeKey, string> = { week: 'bu hafta', '30d': 'son 30 gün', all: 'tüm zamanlar' }

const CATEGORY: Record<ToolCategory, { label: string; color: string }> = {
  shell: { label: 'Shell', color: 'var(--cat-1)' },
  files: { label: 'Dosyalar', color: 'var(--cat-3)' },
  mcp: { label: 'MCP', color: 'var(--cat-2)' },
  web: { label: 'Web', color: 'var(--cat-4)' },
  agents: { label: 'Subagent', color: 'var(--heat-4)' },
  planning: { label: 'Planlama ve sorular', color: 'var(--heat-1)' },
  skills: { label: "Skill'ler", color: 'var(--ink-3)' },
  other: { label: 'Diğer', color: 'var(--line-strong)' },
}

const FEATURE: Record<FeatureKey, { label: string; hint: string }> = {
  mcp: { label: 'MCP araçları', hint: 'Bağlı MCP sunucularının araçları' },
  interrupt: { label: 'Interrupt', hint: "Claude'u çalışırken Esc ile durdurdun" },
  web: { label: 'Web', hint: 'Web araması ya da sayfa okuma' },
  questions: { label: 'Seçenekli soru', hint: 'Claude sana seçenek sunarak soru sordu' },
  compact: { label: 'Compact', hint: 'Context dolunca ya da /compact ile konuşma özetlendi' },
  skills: { label: 'Skill', hint: 'Bir skill yüklendi' },
  commands: { label: 'Slash komutu', hint: '/compact, /model gibi komutlar' },
  subagents: { label: 'Subagent', hint: "Claude bir işi subagent'a devretti" },
  shell: { label: 'Bash mode', hint: "Prompt'ta ! ile doğrudan shell komutu çalıştırdın" },
  tasks: { label: 'Todo listesi', hint: 'TodoWrite ya da Task araçları' },
  plan: { label: 'Plan mode', hint: 'Claude işe başlamadan planını onayına sundu' },
  fast: { label: 'Fast mode', hint: 'Fast mode ile gönderilen istekler' },
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0)
const pctText = (part: number, whole: number) => {
  if (whole <= 0 || part <= 0) return '%0'
  const v = (part / whole) * 100
  return v < 1 ? "%1'den az" : `%${Math.round(v)}`
}

export function Tools() {
  const [range, setRange] = useRange('30d')
  const { data, error, stale } = useApi<ToolsReport>(`/api/tools?range=${range}`, { keepPrevious: true })

  return (
    <div className="mx-auto max-w-[1180px] space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em]">Araçlar</h1>
          <p className="text-[14px] text-ink-2">Claude'un hangi araçları, skill'leri, subagent'ları ve MCP sunucularını ne sıklıkla kullandığı.</p>
        </div>
        <RangePicker value={range} onChange={setRange} />
      </header>

      {error ? <ErrorNote message={error} /> : null}
      {!data && !error ? (
        <div className="space-y-4">
          <Skeleton className="h-[88px] w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : null}

      {data ? (
        <div className={cx('space-y-6 transition-opacity', stale && 'opacity-60')} aria-busy={stale}>
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
            <Stat label="Araç çağrısı" value={fmtInt(data.totals.calls)} note={`${fmtInt(data.sessions)} oturumda, subagent'lar dahil`} />
            <Stat
              label="Başarısız"
              value={pctText(data.totals.errors, data.totals.calls)}
              note={`${fmtInt(data.totals.errors)} çağrı hata döndü`}
            />
            <Stat label="Reddedilen" value={fmtInt(data.totals.denied)} note="izin vermediğin çağrılar" />
            <Stat label="API hatası" value={fmtInt(data.totals.apiErrors)} note={`${fmtInt(data.totals.apiRetries)} istek yeniden denendi`} />
          </dl>

          {data.totals.calls === 0 ? (
            <p className="text-ink-2">{rangeSpan(range)} kayıtlı araç çağrısı yok.</p>
          ) : (
            <>
              <Card>
                <CardHeader title="Türlere göre" aside={RANGE_LOWER[range]} />
                <div className="px-5 pb-5">
                  <ShareBar
                    format={fmtInt}
                    parts={data.categories.map((c) => ({ label: CATEGORY[c.key].label, value: c.calls, color: CATEGORY[c.key].color }))}
                  />
                </div>
              </Card>

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
                <ToolTable tools={data.tools} range={range} />
                <div className="space-y-6">
                  <McpCard servers={data.mcp} />
                  <UsageCard
                    title="Subagent'lar"
                    aside={data.subagents.cost > 0 ? `maliyetin ${withPossessive(Math.round(data.subagents.share * 100), '%')}, ${fmtUsd(data.subagents.cost)}` : undefined}
                    items={data.agents}
                    empty="Bu dönemde subagent kullanılmadı."
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <UsageCard title="Skill'ler" items={data.skills} empty="Bu dönemde skill yüklenmedi." splitPrefix />
                <UsageCard title="Slash komutları" items={data.commands} empty="Bu dönemde slash komutu kullanılmadı." unit="kez" />
              </div>
            </>
          )}

          <FeatureCard features={data.features} sessions={data.sessions} range={range} />
          <VersionCard versions={data.versions} />
        </div>
      ) : null}
    </div>
  )
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="bg-surface px-5 py-4">
      <dt className="text-[12px] text-ink-3">{label}</dt>
      <dd className="mt-0.5 font-display text-[24px] leading-tight font-semibold tracking-[-0.02em] num">{value}</dd>
      <dd className="mt-0.5 text-[12px] text-ink-2">{note}</dd>
    </div>
  )
}

function ToolTable({ tools, range }: { tools: ToolsReport['tools']; range: RangeKey }) {
  const max = Math.max(...tools.map((t) => t.calls), 1)
  return (
    <Card>
      <CardHeader title="Yerleşik araçlar" aside={`${RANGE_LOWER[range]}, çağrı sayısına göre`} />
      <div className="overflow-x-auto px-5 pb-4">
        <table className="w-full min-w-[440px] table-fixed text-[13px]">
          <colgroup>
            <col className="w-[34%]" />
            <col />
            <col className="w-[5.5rem]" />
            <col className="w-[4.5rem]" />
          </colgroup>
          <thead>
            <tr className="text-left text-[12px] text-ink-3">
              <th className="pb-2 font-normal">Araç</th>
              <th className="pb-2 font-normal">Çağrı</th>
              <th className="pb-2 text-right font-normal">Başarısız</th>
              <th className="pb-2 text-right font-normal">Oturum</th>
            </tr>
          </thead>
          <tbody>
            {tools.map((t) => (
              <tr key={t.name} className="border-t border-line">
                <td className="py-1.5 pr-3">
                  <span className="block truncate font-mono text-[12px]" title={t.name}>{t.name}</span>
                  <span className="block text-[11px] text-ink-3">{CATEGORY[t.category].label}</span>
                </td>
                <td className="py-1.5 pr-3">
                  <span className="flex items-center gap-2">
                    <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-line/50">
                      <span className="block h-full rounded-full bg-[var(--heat-3)]" style={{ width: `${(t.calls / max) * 100}%` }} />
                    </span>
                    <span className="w-14 text-right font-mono text-[12px] num">{fmtInt(t.calls)}</span>
                  </span>
                </td>
                <td
                  className={cx('py-1.5 text-right font-mono text-[12px] num', t.errors > 0 ? 'text-danger' : 'text-ink-3')}
                  title={`${fmtInt(t.errors)} hata${t.denied ? `, ${fmtInt(t.denied)} reddedildi` : ''}`}
                >
                  {t.errors > 0 ? pctText(t.errors, t.calls) : '—'}
                </td>
                <td className="py-1.5 text-right font-mono text-[12px] text-ink-2 num">{fmtInt(t.sessions)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function McpCard({ servers }: { servers: ToolsReport['mcp'] }) {
  return (
    <Card>
      <CardHeader title="MCP sunucuları" aside={servers.length ? `${servers.length} sunucu` : undefined} />
      {servers.length === 0 ? (
        <p className="px-5 pb-5 text-ink-2">Bu dönemde MCP aracı çağrılmadı.</p>
      ) : (
        <ul className="px-5 pb-4">
          {servers.map((s) => (
            <li key={s.name} className="border-t border-line py-2 first:border-t-0">
              <div className="flex items-baseline gap-3 text-[13px]">
                <span className="min-w-0 flex-1 truncate font-mono text-[12px]" title={s.name}>
                  {mcpServerLabel(s.name)}
                </span>
                {s.errors > 0 ? <span className="text-[12px] text-danger num">{fmtInt(s.errors)} hata</span> : null}
                <span className="font-mono text-[12px] num">{fmtInt(s.calls)}</span>
              </div>
              <p className="truncate text-[12px] text-ink-3" title={s.tools.map((t) => t.name).join(', ')}>
                {s.tools.map((t) => t.name).join(' · ')} · {fmtInt(s.sessions)} oturum
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function UsageCard({
  title, aside, items, empty, unit = 'çağrı', splitPrefix = false,
}: { title: string; aside?: string; items: UsageStat[]; empty: string; unit?: string; splitPrefix?: boolean }) {
  return (
    <Card>
      <CardHeader title={title} aside={aside} />
      {items.length === 0 ? (
        <p className="px-5 pb-5 text-ink-2">{empty}</p>
      ) : (
        <ul className="px-5 pb-4">
          {items.map((it) => {
            // "plugin:skill" names: the skill is what you'd recognize, the plugin is context.
            const cut = splitPrefix ? it.name.lastIndexOf(':') : -1
            return (
              <li key={it.name} className="border-t border-line py-1.5 first:border-t-0">
                <div className="flex items-baseline gap-3 text-[13px]">
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px]" title={it.name}>
                    {cut > 0 ? <span className="text-ink-3">{it.name.slice(0, cut + 1)}</span> : null}
                    {cut > 0 ? it.name.slice(cut + 1) : it.name}
                  </span>
                  <span className="font-mono text-[12px] num">
                    {fmtInt(it.calls)} <span className="text-ink-3">{unit}</span>
                  </span>
                </div>
                <p className="text-[12px] text-ink-3" title={fmtDateTime(it.lastTs)}>
                  {fmtInt(it.sessions)} oturum · en son {fmtRelative(it.lastTs)}
                </p>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

function FeatureCard({ features, sessions, range }: { features: ToolsReport['features']; sessions: number; range: RangeKey }) {
  const sorted = [...features].sort((a, b) => b.sessions - a.sessions || b.uses - a.uses)
  return (
    <Card>
      <CardHeader title="Özellik kullanımı" aside={`${RANGE_LOWER[range]}, ${fmtInt(sessions)} oturumun kaçında`} />
      <ul className="grid grid-cols-1 gap-x-8 px-5 pb-4 md:grid-cols-2">
        {sorted.map((f) => {
          const share = pct(f.sessions, sessions)
          return (
            <li key={f.key} className={cx('border-t border-line py-2', f.sessions === 0 && 'opacity-55')}>
              <div className="flex items-baseline gap-3 text-[13px]">
                <span className="min-w-0 flex-1 truncate">{FEATURE[f.key].label}</span>
                <span className="text-[12px] text-ink-3 num">{f.sessions > 0 ? `${fmtInt(f.uses)} kez` : 'hiç'}</span>
                <span className="w-24 text-right font-mono text-[12px] num">
                  {fmtInt(f.sessions)}/{fmtInt(sessions)} <span className="text-ink-3">%{share}</span>
                </span>
              </div>
              <div className="mt-1 flex items-center gap-3">
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line/50">
                  <span className="block h-full rounded-full bg-[var(--heat-3)]" style={{ width: `${share}%` }} />
                </span>
              </div>
              <p className="mt-0.5 text-[12px] text-ink-3">{FEATURE[f.key].hint}</p>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

function VersionCard({ versions }: { versions: ToolsReport['versions'] }) {
  if (versions.length === 0) return null
  return (
    <Card>
      <CardHeader title="Claude Code sürümleri" aside="oturumun en son çalıştığı sürüm" />
      <div className="overflow-x-auto px-5 pb-4">
        <table className="w-full min-w-[420px] text-[13px]">
          <thead>
            <tr className="text-left text-[12px] text-ink-3">
              <th className="pb-2 font-normal">Sürüm</th>
              <th className="pb-2 text-right font-normal">Oturum</th>
              <th className="pb-2 text-right font-normal">İlk</th>
              <th className="pb-2 text-right font-normal">Son</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.version} className="border-t border-line">
                <td className="py-1.5 font-mono text-[12px]">{v.version}</td>
                <td className="py-1.5 text-right font-mono text-[12px] num">{fmtInt(v.sessions)}</td>
                <td className="py-1.5 text-right text-[12px] text-ink-2">{fmtDateTime(v.firstTs)}</td>
                <td className="py-1.5 text-right text-[12px] text-ink-2">{fmtRelative(v.lastTs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

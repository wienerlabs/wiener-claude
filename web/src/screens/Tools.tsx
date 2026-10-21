import type { FeatureKey, RangeKey, ToolCategory, ToolsReport, UsageStat } from '../../../shared/types.ts'
import { withPossessive } from '../../../shared/tr.ts'
import { ShareBar } from '../components/charts.tsx'
import { Card, CardHeader, ErrorNote, Skeleton, cx } from '../components/ui.tsx'
import { useApi } from '../lib/api.ts'
import { fmtCount, fmtDateTime, fmtInt, fmtRelative, fmtUsd, mcpServerLabel } from '../lib/format.ts'
import { tx } from '../lib/i18n.ts'
import { RangePicker, rangeSpan, useRange } from '../lib/range.tsx'

const rangeLower = (range: RangeKey) =>
  range === 'week' ? tx('bu hafta', 'this week') : range === '30d' ? tx('son 30 gün', 'last 30 days') : tx('tüm zamanlar', 'all time')

const category = (key: ToolCategory): { label: string; color: string } => {
  switch (key) {
    case 'shell':
      return { label: 'Shell', color: 'var(--cat-1)' }
    case 'files':
      return { label: tx('Dosyalar', 'Files'), color: 'var(--cat-3)' }
    case 'mcp':
      return { label: 'MCP', color: 'var(--cat-2)' }
    case 'web':
      return { label: 'Web', color: 'var(--cat-4)' }
    case 'agents':
      return { label: tx('Subagent', 'Subagents'), color: 'var(--heat-4)' }
    case 'planning':
      return { label: tx('Planlama ve sorular', 'Planning and questions'), color: 'var(--heat-1)' }
    case 'skills':
      return { label: tx("Skill'ler", 'Skills'), color: 'var(--ink-3)' }
    case 'other':
      return { label: tx('Diğer', 'Other'), color: 'var(--line-strong)' }
  }
}

const feature = (key: FeatureKey): { label: string; hint: string } => {
  switch (key) {
    case 'mcp':
      return { label: tx('MCP araçları', 'MCP tools'), hint: tx('Bağlı MCP sunucularının araçları', 'Tools from connected MCP servers') }
    case 'interrupt':
      return { label: 'Interrupt', hint: tx("Claude'u çalışırken Esc ile durdurdun", 'You stopped Claude mid-task with Esc') }
    case 'web':
      return { label: 'Web', hint: tx('Web araması ya da sayfa okuma', 'Web search or fetching a page') }
    case 'questions':
      return { label: tx('Seçenekli soru', 'Multiple-choice question'), hint: tx('Claude sana seçenek sunarak soru sordu', 'Claude asked you a question with options to pick from') }
    case 'compact':
      return { label: 'Compact', hint: tx('Context dolunca ya da /compact ile konuşma özetlendi', 'The conversation was summarized when the context filled up, or with /compact') }
    case 'skills':
      return { label: 'Skill', hint: tx('Bir skill yüklendi', 'A skill was loaded') }
    case 'commands':
      return { label: tx('Slash komutu', 'Slash command'), hint: tx('/compact, /model gibi komutlar', 'Commands such as /compact and /model') }
    case 'subagents':
      return { label: 'Subagent', hint: tx("Claude bir işi subagent'a devretti", 'Claude handed off work to a subagent') }
    case 'shell':
      return { label: 'Bash mode', hint: tx("Prompt'ta ! ile doğrudan shell komutu çalıştırdın", 'You ran a shell command directly with ! in the prompt') }
    case 'tasks':
      return { label: tx('Todo listesi', 'Todo list'), hint: tx('TodoWrite ya da Task araçları', 'TodoWrite or the Task tools') }
    case 'plan':
      return { label: 'Plan mode', hint: tx('Claude işe başlamadan planını onayına sundu', 'Claude asked you to approve a plan before starting') }
    case 'fast':
      return { label: 'Fast mode', hint: tx('Fast mode ile gönderilen istekler', 'Requests sent in fast mode') }
  }
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0)
const pctText = (part: number, whole: number) => {
  if (whole <= 0 || part <= 0) return tx('%0', '0%')
  const v = (part / whole) * 100
  return v < 1 ? tx("%1'den az", '<1%') : tx(`%${Math.round(v)}`, `${Math.round(v)}%`)
}

export function Tools() {
  const [range, setRange] = useRange('30d')
  const { data, error, stale } = useApi<ToolsReport>(`/api/tools?range=${range}`, { keepPrevious: true })

  return (
    <div className="mx-auto max-w-[1180px] space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em]">{tx('Araçlar', 'Tools')}</h1>
          <p className="text-[14px] text-ink-2">
            {tx(
              "Claude'un hangi araçları, skill'leri, subagent'ları ve MCP sunucularını ne sıklıkla kullandığı.",
              'How often Claude uses each tool, skill, subagent and MCP server.',
            )}
          </p>
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
            <Stat
              label={tx('Araç çağrısı', 'Tool calls')}
              value={fmtInt(data.totals.calls)}
              note={tx(
                `${fmtInt(data.sessions)} oturumda, subagent'lar dahil`,
                `across ${fmtCount(data.sessions, 'oturum', 'session')}, subagents included`,
              )}
            />
            <Stat
              label={tx('Başarısız', 'Failed')}
              value={pctText(data.totals.errors, data.totals.calls)}
              note={tx(
                `${fmtInt(data.totals.errors)} çağrı hata döndü`,
                `${fmtCount(data.totals.errors, 'çağrı', 'call')} returned an error`,
              )}
            />
            <Stat label={tx('Reddedilen', 'Denied')} value={fmtInt(data.totals.denied)} note={tx('izin vermediğin çağrılar', "calls you didn't allow")} />
            <Stat
              label={tx('API hatası', 'API errors')}
              value={fmtInt(data.totals.apiErrors)}
              note={tx(
                `${fmtInt(data.totals.apiRetries)} istek yeniden denendi`,
                `${fmtCount(data.totals.apiRetries, 'istek', 'request')} retried`,
              )}
            />
          </dl>

          {data.totals.calls === 0 ? (
            <p className="text-ink-2">
              {tx(
                `${rangeSpan(range)} kayıtlı araç çağrısı yok.`,
                range === 'week' ? 'No tool calls recorded this week.' : range === '30d' ? 'No tool calls recorded in the last 30 days.' : 'No tool calls recorded yet.',
              )}
            </p>
          ) : (
            <>
              <Card>
                <CardHeader title={tx('Türlere göre', 'By type')} aside={rangeLower(range)} />
                <div className="px-5 pb-5">
                  <ShareBar
                    format={fmtInt}
                    parts={data.categories.map((c) => ({ ...category(c.key), value: c.calls }))}
                  />
                </div>
              </Card>

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
                <ToolTable tools={data.tools} range={range} />
                <div className="space-y-6">
                  <McpCard servers={data.mcp} />
                  <UsageCard
                    title={tx("Subagent'lar", 'Subagents')}
                    aside={
                      data.subagents.cost > 0
                        ? tx(
                            `maliyetin ${withPossessive(Math.round(data.subagents.share * 100), '%')}, ${fmtUsd(data.subagents.cost)}`,
                            `${Math.round(data.subagents.share * 100)}% of cost, ${fmtUsd(data.subagents.cost)}`,
                          )
                        : undefined
                    }
                    items={data.agents}
                    empty={tx('Bu dönemde subagent kullanılmadı.', 'No subagents used in this period.')}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <UsageCard title={tx("Skill'ler", 'Skills')} items={data.skills} empty={tx('Bu dönemde skill yüklenmedi.', 'No skills loaded in this period.')} splitPrefix />
                <UsageCard
                  title={tx('Slash komutları', 'Slash commands')}
                  items={data.commands}
                  empty={tx('Bu dönemde slash komutu kullanılmadı.', 'No slash commands used in this period.')}
                  unit={['kez', 'use', 'uses']}
                />
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
      <CardHeader title={tx('Yerleşik araçlar', 'Built-in tools')} aside={tx(`${rangeLower(range)}, çağrı sayısına göre`, `${rangeLower(range)}, by call count`)} />
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
              <th className="pb-2 font-normal">{tx('Araç', 'Tool')}</th>
              <th className="pb-2 font-normal">{tx('Çağrı', 'Calls')}</th>
              <th className="pb-2 text-right font-normal">{tx('Başarısız', 'Failed')}</th>
              <th className="pb-2 text-right font-normal">{tx('Oturum', 'Sessions')}</th>
            </tr>
          </thead>
          <tbody>
            {tools.map((t) => (
              <tr key={t.name} className="border-t border-line">
                <td className="py-1.5 pr-3">
                  <span className="block truncate font-mono text-[12px]" title={t.name}>{t.name}</span>
                  <span className="block text-[11px] text-ink-3">{category(t.category).label}</span>
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
                  title={tx(
                    `${fmtInt(t.errors)} hata${t.denied ? `, ${fmtInt(t.denied)} reddedildi` : ''}`,
                    `${fmtCount(t.errors, 'hata', 'error')}${t.denied ? `, ${fmtInt(t.denied)} denied` : ''}`,
                  )}
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
      <CardHeader
        title={tx('MCP sunucuları', 'MCP servers')}
        aside={servers.length ? tx(`${servers.length} sunucu`, `${servers.length} ${servers.length === 1 ? 'server' : 'servers'}`) : undefined}
      />
      {servers.length === 0 ? (
        <p className="px-5 pb-5 text-ink-2">{tx('Bu dönemde MCP aracı çağrılmadı.', 'No MCP tools called in this period.')}</p>
      ) : (
        <ul className="px-5 pb-4">
          {servers.map((s) => (
            <li key={s.name} className="border-t border-line py-2 first:border-t-0">
              <div className="flex items-baseline gap-3 text-[13px]">
                <span className="min-w-0 flex-1 truncate font-mono text-[12px]" title={s.name}>
                  {mcpServerLabel(s.name)}
                </span>
                {s.errors > 0 ? <span className="text-[12px] text-danger num">{fmtCount(s.errors, 'hata', 'error')}</span> : null}
                <span className="font-mono text-[12px] num">{fmtInt(s.calls)}</span>
              </div>
              <p className="truncate text-[12px] text-ink-3" title={s.tools.map((t) => t.name).join(', ')}>
                {s.tools.map((t) => t.name).join(' · ')} · {fmtCount(s.sessions, 'oturum', 'session')}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function UsageCard({
  title, aside, items, empty, unit = ['çağrı', 'call', 'calls'], splitPrefix = false,
}: { title: string; aside?: string; items: UsageStat[]; empty: string; unit?: [tr: string, enOne: string, enMany: string]; splitPrefix?: boolean }) {
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
                    {fmtInt(it.calls)} <span className="text-ink-3">{tx(unit[0], it.calls === 1 ? unit[1] : unit[2])}</span>
                  </span>
                </div>
                <p className="text-[12px] text-ink-3" title={fmtDateTime(it.lastTs)}>
                  {tx(
                    `${fmtInt(it.sessions)} oturum · en son ${fmtRelative(it.lastTs)}`,
                    `${fmtCount(it.sessions, 'oturum', 'session')} · last used ${fmtRelative(it.lastTs)}`,
                  )}
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
      <CardHeader
        title={tx('Özellik kullanımı', 'Feature usage')}
        aside={tx(
          `${rangeLower(range)}, ${fmtInt(sessions)} oturumun kaçında`,
          `${rangeLower(range)}, out of ${fmtCount(sessions, 'oturum', 'session')}`,
        )}
      />
      <ul className="grid grid-cols-1 gap-x-8 px-5 pb-4 md:grid-cols-2">
        {sorted.map((f) => {
          const share = pct(f.sessions, sessions)
          return (
            <li key={f.key} className={cx('border-t border-line py-2', f.sessions === 0 && 'opacity-55')}>
              <div className="flex items-baseline gap-3 text-[13px]">
                <span className="min-w-0 flex-1 truncate">{feature(f.key).label}</span>
                <span className="text-[12px] text-ink-3 num">
                  {f.sessions > 0 ? tx(`${fmtInt(f.uses)} kez`, f.uses === 1 ? 'once' : `${fmtInt(f.uses)} times`) : tx('hiç', 'never')}
                </span>
                <span className="w-24 text-right font-mono text-[12px] num">
                  {fmtInt(f.sessions)}/{fmtInt(sessions)} <span className="text-ink-3">{tx(`%${share}`, `${share}%`)}</span>
                </span>
              </div>
              <div className="mt-1 flex items-center gap-3">
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line/50">
                  <span className="block h-full rounded-full bg-[var(--heat-3)]" style={{ width: `${share}%` }} />
                </span>
              </div>
              <p className="mt-0.5 text-[12px] text-ink-3">{feature(f.key).hint}</p>
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
      <CardHeader title={tx('Claude Code sürümleri', 'Claude Code versions')} aside={tx('oturumun en son çalıştığı sürüm', 'the latest version each session ran on')} />
      <div className="overflow-x-auto px-5 pb-4">
        <table className="w-full min-w-[420px] text-[13px]">
          <thead>
            <tr className="text-left text-[12px] text-ink-3">
              <th className="pb-2 font-normal">{tx('Sürüm', 'Version')}</th>
              <th className="pb-2 text-right font-normal">{tx('Oturum', 'Sessions')}</th>
              <th className="pb-2 text-right font-normal">{tx('İlk', 'First')}</th>
              <th className="pb-2 text-right font-normal">{tx('Son', 'Last')}</th>
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

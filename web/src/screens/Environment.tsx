import { CheckCircle2, ChevronRight, Circle, CircleDot, FileText, Lock, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { EnvReport, FileContent, MemoryType, PlanItem, TaskGroup, TaskStatus } from '../../../shared/types.ts'
import { HBars } from '../components/charts.tsx'
import { Card, CardHeader, ErrorNote, Segmented, Skeleton, cx } from '../components/ui.tsx'
import { useApi } from '../lib/api.ts'
import { fmtDateTime, fmtInt, fmtRelative } from '../lib/format.ts'
import { onLinkClick, useLocation } from '../lib/router.ts'

type Section = 'memory' | 'talimatlar' | 'gorevler' | 'skill' | 'mcp' | 'ayarlar'

const SECTIONS: { value: Section; label: string; count: (r: EnvReport) => number | null }[] = [
  { value: 'memory', label: 'Memory', count: (r) => r.memory.filter((m) => m.type !== 'index').length },
  { value: 'talimatlar', label: 'Talimatlar', count: (r) => r.instructions.length },
  { value: 'gorevler', label: 'Görevler', count: (r) => r.tasks.reduce((s, g) => s + g.tasks.filter((t) => t.status !== 'completed').length, 0) },
  { value: 'skill', label: "Skill ve plugin'ler", count: (r) => r.skills.length },
  { value: 'mcp', label: 'MCP', count: (r) => r.mcp.length },
  { value: 'ayarlar', label: 'Ayarlar', count: () => null },
]

export function Environment() {
  const { query } = useLocation()
  const section = (SECTIONS.find((s) => s.value === query.get('bolum'))?.value ?? 'memory') as Section
  const { data, error } = useApi<EnvReport>('/api/env')

  return (
    <div className="mx-auto max-w-[1280px] space-y-5">
      <header>
        <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em]">Ortam</h1>
        <p className="text-[14px] text-ink-2">Claude Code'un bu bilgisayarda hatırladıkları, uyduğu talimatlar, yarım kalan işler, kullandığı araçlar ve ayarlar.</p>
      </header>
      <nav aria-label="Ortam bölümleri" className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <div className="inline-flex gap-1 rounded-lg border border-line bg-surface p-0.5">
          {SECTIONS.map((s) => {
            const href = `/ortam?bolum=${s.value}`
            const count = data ? s.count(data) : null
            return (
              <a
                key={s.value}
                href={href}
                onClick={(e) => onLinkClick(e, href)}
                aria-current={section === s.value ? 'page' : undefined}
                className={cx(
                  'whitespace-nowrap rounded-md px-3 py-1.5 text-[13px] transition-colors',
                  section === s.value ? 'bg-accent-soft font-medium text-accent' : 'text-ink-2 hover:text-ink',
                )}
              >
                {s.label}
                {count !== null ? <span className="ml-1.5 font-mono text-[11px] text-ink-3 num">{count}</span> : null}
              </a>
            )
          })}
        </div>
      </nav>
      {error ? <ErrorNote message={error} /> : null}
      {!data && !error ? <Skeleton className="h-80 w-full" /> : null}
      {data ? (
        section === 'memory' ? <MemorySection r={data} />
        : section === 'talimatlar' ? <InstructionsSection r={data} />
        : section === 'gorevler' ? <TasksSection r={data} />
        : section === 'skill' ? <SkillsSection r={data} />
        : section === 'mcp' ? <McpSection r={data} />
        : <SettingsSection r={data} />
      ) : null}
    </div>
  )
}

// ---- files -------------------------------------------------------------------------------------

const MEMORY_LABEL: Record<MemoryType, string> = {
  user: 'Kullanıcı', feedback: 'Geri bildirim', project: 'Proje', reference: 'Referans', index: 'Dizin', other: 'Diğer',
}
const MEMORY_COLOR: Partial<Record<MemoryType, string>> = {
  user: 'var(--cat-1)', feedback: 'var(--cat-2)', project: 'var(--cat-3)', reference: 'var(--cat-4)',
}

function MemorySection({ r }: { r: EnvReport }) {
  const [type, setType] = useState<'all' | MemoryType>('all')
  const [text, setText] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const files = useMemo(() => {
    const needle = text.trim().toLocaleLowerCase('tr')
    return r.memory.filter(
      (m) => (type === 'all' ? m.type !== 'index' : m.type === type) &&
        (!needle || `${m.name} ${m.description ?? ''} ${m.projectName}`.toLocaleLowerCase('tr').includes(needle)),
    )
  }, [r.memory, type, text])
  const present = (['user', 'feedback', 'project', 'reference', 'other', 'index'] as MemoryType[]).filter((t) => r.memory.some((m) => m.type === t))
  if (r.memory.length === 0) {
    return <Empty title="Henüz memory dosyası yok" body="Claude Code bir şeyi hatırlamaya karar verdiğinde ~/.claude/projects/<proje>/memory klasörüne yazar; o dosyalar burada görünür." />
  }
  const selected = files.find((f) => f.id === open) ?? files[0] ?? null
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-3">
        <div role="radiogroup" aria-label="Tür" className="flex flex-wrap gap-1.5">
          {[{ value: 'all' as const, label: 'Tümü' }, ...present.map((t) => ({ value: t, label: MEMORY_LABEL[t] }))].map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={type === o.value}
              onClick={() => setType(o.value)}
              className={cx(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors',
                type === o.value ? 'border-accent bg-accent-soft font-medium text-accent' : 'border-line bg-surface text-ink-2 hover:text-ink',
              )}
            >
              {o.value !== 'all' && MEMORY_COLOR[o.value] ? <span className="size-2 rounded-full" style={{ background: MEMORY_COLOR[o.value] }} aria-hidden /> : null}
              {o.label}
            </button>
          ))}
        </div>
        <SearchBox value={text} onChange={setText} placeholder="Adda, açıklamada ya da projede ara" />
        <p className="text-[12px] text-ink-3 num">{fmtInt(files.length)} dosya</p>
        <ul className="overflow-hidden rounded-xl border border-line bg-surface">
          {files.map((m) => (
            <li key={m.id} className="border-t border-line first:border-t-0">
              <button
                type="button"
                onClick={() => setOpen(open === m.id ? null : m.id)}
                aria-pressed={selected?.id === m.id}
                className={cx('block w-full px-4 py-2.5 text-left transition-colors', selected?.id === m.id ? 'bg-accent-soft' : 'hover:bg-raised')}
              >
                <span className="flex items-center gap-2">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: MEMORY_COLOR[m.type] ?? 'var(--line-strong)' }} aria-hidden />
                  <span className="truncate text-[14px] font-medium">{m.name}</span>
                </span>
                {m.description ? <span className="mt-0.5 line-clamp-2 block text-[12px] text-ink-2">{m.description}</span> : null}
                <span className="mt-0.5 block text-[11px] text-ink-3">
                  {MEMORY_LABEL[m.type]} · {m.projectName} · {fmtRelative(m.mtime)}
                </span>
              </button>
              {/* On narrow screens the file opens right under the row tapped, not below the whole list. */}
              {open === m.id ? (
                <div className="border-t border-line p-2 lg:hidden">
                  <FilePreview id={m.id} file={m.file} meta={`${MEMORY_LABEL[m.type]} · ${m.projectName} · ${fmtDateTime(m.mtime)}`} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
      {selected ? (
        <div className="hidden min-w-0 lg:block">
          <FilePreview id={selected.id} file={selected.file} meta={`${MEMORY_LABEL[selected.type]} · ${selected.projectName} · ${fmtDateTime(selected.mtime)}`} />
        </div>
      ) : null}
    </div>
  )
}

function InstructionsSection({ r }: { r: EnvReport }) {
  const [open, setOpen] = useState<string | null>(null)
  if (r.instructions.length === 0) {
    return <Empty title="CLAUDE.md dosyası bulunamadı" body="~/.claude/CLAUDE.md ya da proje kökündeki CLAUDE.md, Claude Code'a her oturumda verilen talimatlardır. Oluşturduğunda burada görünür." />
  }
  const selected = r.instructions.find((f) => f.id === open) ?? r.instructions[0]
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <ul className="h-fit overflow-hidden rounded-xl border border-line bg-surface">
        {r.instructions.map((f) => (
          <li key={f.id} className="border-t border-line first:border-t-0">
            <button
              type="button"
              onClick={() => setOpen(open === f.id ? null : f.id)}
              aria-pressed={selected?.id === f.id}
              className={cx('block w-full px-4 py-2.5 text-left', selected?.id === f.id ? 'bg-accent-soft' : 'hover:bg-raised')}
            >
              <span className="block text-[14px] font-medium">{f.scope}</span>
              <span className="block truncate font-mono text-[11px] text-ink-3">{f.file}</span>
              <span className="block text-[11px] text-ink-3 num">{fmtInt(f.size)} bayt · {fmtRelative(f.mtime)}</span>
            </button>
            {open === f.id ? (
              <div className="border-t border-line p-2 lg:hidden">
                <FilePreview id={f.id} file={f.file} meta={`${f.scope} · ${fmtDateTime(f.mtime)}`} />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {selected ? (
        <div className="hidden min-w-0 lg:block">
          <FilePreview id={selected.id} file={selected.file} meta={`${selected.scope} · ${fmtDateTime(selected.mtime)}`} />
        </div>
      ) : null}
    </div>
  )
}

function FilePreview({ id, file, meta }: { id: string; file: string; meta: string }) {
  const { data, error } = useApi<FileContent>(`/api/env/file/${id}`)
  return (
    <Card className="min-w-0 self-start">
      <div className="border-b border-line px-5 py-3">
        <p className="flex items-center gap-1.5 truncate font-mono text-[12px] text-ink-2">
          <FileText className="size-3.5 shrink-0" aria-hidden />
          {file}
        </p>
        <p className="text-[12px] text-ink-3">{meta}</p>
      </div>
      <div className="px-5 py-4">
        {error ? <ErrorNote message={error} /> : null}
        {!data && !error ? <Skeleton className="h-40 w-full" /> : null}
        {data ? (
          <>
            <div className="md text-[14px] leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
                {data.text.replace(/^---\n[\s\S]*?\n---\n?/, '')}
              </ReactMarkdown>
            </div>
            {data.truncated ? <p className="mt-3 text-[12px] text-ink-3">Dosya uzun; ilk 200 bin karakteri gösteriliyor.</p> : null}
          </>
        ) : null}
      </div>
    </Card>
  )
}

// ---- tasks and plans ---------------------------------------------------------------------------

const STATUS: Record<TaskStatus, { label: string; icon: typeof Circle; className: string }> = {
  pending: { label: 'bekliyor', icon: Circle, className: 'text-ink-3' },
  in_progress: { label: 'devam ediyor', icon: CircleDot, className: 'text-accent' },
  completed: { label: 'tamamlandı', icon: CheckCircle2, className: 'text-good' },
  deleted: { label: 'silindi', icon: Circle, className: 'text-ink-3' },
}

function TasksSection({ r }: { r: EnvReport }) {
  const [filter, setFilter] = useState<'open' | 'all'>('open')
  const groups: TaskGroup[] = r.tasks
    .map((g) => ({ ...g, tasks: filter === 'open' ? g.tasks.filter((t) => t.status !== 'completed') : g.tasks }))
    .filter((g) => g.tasks.length > 0)
  const openCount = r.tasks.reduce((s, g) => s + g.tasks.filter((t) => t.status !== 'completed').length, 0)
  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-2">
          <h2 className="text-[13px] font-medium">Görev listeleri</h2>
          <Segmented<'open' | 'all'>
            label="Görev filtresi"
            value={filter}
            onChange={setFilter}
            options={[{ value: 'open', label: `Açık (${openCount})` }, { value: 'all', label: 'Tümü' }]}
          />
        </div>
        {groups.length === 0 ? (
          <p className="px-5 pb-5 text-ink-2">
            {r.tasks.length === 0 ? 'Claude Code henüz bir görev listesi tutmamış.' : 'Açık görev yok; listelerdeki her iş tamamlanmış.'}
          </p>
        ) : (
          <ul className="px-5 pb-4">
            {groups.map((g) => (
              <li key={g.sessionId} className="border-t border-line py-3 first:border-t-0">
                <a href={`/oturumlar/${g.sessionId}`} onClick={(e) => onLinkClick(e, `/oturumlar/${g.sessionId}`)} className="group block">
                  <span className="text-[14px] font-medium group-hover:underline group-hover:underline-offset-2">{g.title}</span>
                  <span className="ml-2 text-[12px] text-ink-3">{g.projectName} · {fmtRelative(g.lastTs)}</span>
                </a>
                <ul className="mt-1.5 space-y-1">
                  {g.tasks.map((t) => {
                    const s = STATUS[t.status]
                    return (
                      <li key={t.id} className="flex items-start gap-2 text-[13px]">
                        <s.icon className={cx('mt-0.5 size-3.5 shrink-0', s.className)} aria-label={s.label} />
                        <span className={cx(t.status === 'completed' && 'text-ink-3 line-through decoration-ink-3/50')}>{t.subject}</span>
                      </li>
                    )
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <CardHeader title="Planlar" aside={r.plans.length ? `${r.plans.length} plan` : null} />
        {r.plans.length === 0 ? (
          <p className="px-5 pb-5 text-ink-2">Plan mode'da onaya sunulmuş bir plan yok.</p>
        ) : (
          <ul className="px-5 pb-4">{r.plans.map((p) => <PlanRow key={p.key} p={p} />)}</ul>
        )}
      </Card>
    </div>
  )
}

const OUTCOME: Record<PlanItem['outcome'], { label: string; className: string }> = {
  approved: { label: 'Onaylandı', className: 'bg-[color-mix(in_srgb,var(--good)_14%,transparent)] text-good' },
  rejected: { label: 'Değişiklik istendi', className: 'bg-danger-soft text-danger' },
  unknown: { label: 'Yanıt yok', className: 'bg-raised text-ink-3' },
}

function PlanRow({ p }: { p: PlanItem }) {
  const o = OUTCOME[p.outcome]
  return (
    <li className="border-t border-line py-2 first:border-t-0">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-2">
          <ChevronRight className="size-3.5 shrink-0 text-ink-3 transition-transform group-open:rotate-90" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-[14px]">{p.title}</span>
          <span className={cx('shrink-0 rounded px-1.5 py-0.5 text-[11px]', o.className)}>{o.label}</span>
          <span className="shrink-0 text-[12px] text-ink-3">{fmtRelative(p.ts)}</span>
        </summary>
        <div className="mt-2 pl-5">
          <p className="mb-2 text-[12px] text-ink-3">
            <a href={`/oturumlar/${p.sessionId}`} onClick={(e) => onLinkClick(e, `/oturumlar/${p.sessionId}`)} className="underline underline-offset-2">
              {p.sessionTitle}
            </a>{' '}
            · {p.projectName}
          </p>
          <div className="md rounded-lg border border-line bg-raised px-4 py-3 text-[13px] leading-relaxed">
            <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{p.text}</ReactMarkdown>
          </div>
        </div>
      </details>
    </li>
  )
}

// ---- skills, plugins, MCP ----------------------------------------------------------------------

function SkillsSection({ r }: { r: EnvReport }) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader title="Skill'ler" aside="kullanıma göre" />
        {r.skills.length === 0 ? (
          <p className="px-5 pb-5 text-ink-2">Kurulu ya da kullanılmış bir skill yok.</p>
        ) : (
          <div className="overflow-x-auto px-5 pb-4">
            <table className="w-full min-w-[460px] table-fixed text-[13px]">
              <colgroup>
                <col />
                <col className="w-[9rem]" />
                <col className="w-[5rem]" />
                <col className="w-[7rem]" />
              </colgroup>
              <thead>
                <tr className="text-left text-[12px] text-ink-3">
                  <th className="pb-2 font-normal">Skill</th>
                  <th className="pb-2 font-normal">Kaynak</th>
                  <th className="pb-2 text-right font-normal">Kullanım</th>
                  <th className="pb-2 text-right font-normal">Son</th>
                </tr>
              </thead>
              <tbody>
                {r.skills.map((s) => (
                  <tr key={s.name} className="border-t border-line align-top">
                    <td className="py-2 pr-3">
                      <span className="block truncate font-mono text-[12px]" title={s.name}>{s.name}</span>
                      {s.description ? <span className="line-clamp-2 text-[12px] text-ink-3">{s.description}</span> : null}
                    </td>
                    <td className="truncate py-2 text-[12px] text-ink-2">{s.source}</td>
                    <td className="py-2 text-right font-mono text-[12px] num">{fmtInt(s.uses)}</td>
                    <td className="py-2 text-right text-[12px] whitespace-nowrap text-ink-3">{s.lastUsedAt ? fmtRelative(s.lastUsedAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <div className="space-y-6">
        <Card>
          <CardHeader title="Plugin'ler" />
          {r.plugins.length === 0 ? (
            <p className="px-5 pb-5 text-ink-2">Kurulu plugin yok.</p>
          ) : (
            <ul className="px-5 pb-4">
              {r.plugins.map((p) => (
                <li key={`${p.name}@${p.marketplace}`} className="flex items-baseline gap-2 border-t border-line py-2 first:border-t-0">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px]">{p.name}</span>
                    <span className="text-[12px] text-ink-3">
                      {[p.marketplace, p.version ? `v${p.version}` : null, p.installedAt ? `${fmtRelative(p.installedAt)} kuruldu` : null].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className={cx('rounded px-1.5 py-0.5 text-[11px]', p.enabled ? 'bg-accent-soft text-accent' : 'bg-raised text-ink-3')}>
                    {p.enabled ? 'açık' : 'kapalı'}
                  </span>
                  <span className="w-16 text-right font-mono text-[12px] text-ink-2 num">{fmtInt(p.uses)} kez</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Subagent türleri" aside="Claude'un başlattığı" />
          <div className="px-5 pb-5">
            {r.subagents.length ? <HBars format={fmtInt} items={r.subagents.map((s) => ({ label: s.type, value: s.calls }))} /> : <p className="text-ink-2">Subagent başlatılmamış.</p>}
          </div>
        </Card>
      </div>
    </div>
  )
}

function McpSection({ r }: { r: EnvReport }) {
  return (
    <Card>
      <CardHeader title="MCP sunucuları" aside={`${r.mcp.length} sunucu`} />
      <p className="flex items-center gap-1.5 px-5 pb-3 text-[12px] text-ink-3">
        <Lock className="size-3.5 shrink-0" aria-hidden /> Ortam değişkenleri, başlıklar ve komut argümanları gizli bilgi taşıyabileceği için gösterilmez.
      </p>
      {r.mcp.length === 0 ? (
        <p className="px-5 pb-5 text-ink-2">Yapılandırılmış ya da kullanılmış bir MCP sunucusu yok.</p>
      ) : (
        <div className="overflow-x-auto px-5 pb-4">
          <table className="w-full min-w-[720px] table-fixed text-[13px]">
            <colgroup>
              <col />
              <col className="w-[11rem]" />
              <col className="w-[14rem]" />
              <col className="w-[5.5rem]" />
              <col className="w-[7rem]" />
            </colgroup>
            <thead>
              <tr className="text-left text-[12px] text-ink-3">
                <th className="pb-2 font-normal">Sunucu</th>
                <th className="pb-2 font-normal">Nerede tanımlı</th>
                <th className="pb-2 font-normal">Çalıştırılan</th>
                <th className="pb-2 text-right font-normal">Çağrı</th>
                <th className="pb-2 text-right font-normal">Son</th>
              </tr>
            </thead>
            <tbody>
              {r.mcp.map((m) => (
                <tr key={m.name} className="border-t border-line align-top">
                  <td className="py-2 pr-3">
                    <span className="block truncate font-mono text-[12px] font-medium" title={m.name}>{m.name}</span>
                    {m.topTools.length ? <span className="block truncate text-[11px] text-ink-3" title={m.topTools.join(', ')}>{m.topTools.join(', ')}</span> : null}
                  </td>
                  <td className="py-2 pr-3 text-[12px] text-ink-2">{m.scope}</td>
                  <td className="truncate py-2 pr-3 font-mono text-[12px] text-ink-2" title={m.target ?? ''}>
                    {m.transport ? <span className="mr-1 text-ink-3">{m.transport}</span> : null}
                    {m.target ?? '—'}
                  </td>
                  <td className="py-2 text-right font-mono text-[12px] num">
                    {fmtInt(m.calls)}
                    {m.errors ? <span className="block text-[11px] text-danger">{fmtInt(m.errors)} hata</span> : null}
                  </td>
                  <td className="py-2 text-right text-[12px] whitespace-nowrap text-ink-3">{m.lastUsedAt ? fmtRelative(m.lastUsedAt) : 'hiç'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

// ---- settings ----------------------------------------------------------------------------------

function SettingsSection({ r }: { r: EnvReport }) {
  const s = r.settings
  if (!s.file) return <Empty title="Ayar dosyası yok" body="~/.claude/settings.json bulunamadı; Claude Code varsayılan ayarlarla çalışıyor." />
  const rules: [string, string[]][] = [['İzin verilen', s.allow], ['Sorulacak', s.ask], ['Yasak', s.deny]]
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Genel" aside={<span className="font-mono">{s.file}</span>} />
        <dl className="px-5 pb-4">
          {s.values.length === 0 ? <p className="text-ink-2">Varsayılanların dışında bir değer yok.</p> : null}
          {s.values.map((v) => (
            <div key={v.key} className="flex items-baseline justify-between gap-4 border-t border-line py-2 first:border-t-0">
              <dt className="font-mono text-[12px] text-ink-2">{v.key}</dt>
              <dd className="font-mono text-[12px]">{v.value}</dd>
            </div>
          ))}
        </dl>
        {s.envKeys.length || s.otherKeys.length ? (
          <div className="space-y-2 border-t border-line px-5 py-4 text-[12px]">
            {s.envKeys.length ? (
              <p className="text-ink-2">
                <span className="text-ink-3">Ortam değişkenleri (yalnızca adları): </span>
                <span className="font-mono">{s.envKeys.join(', ')}</span>
              </p>
            ) : null}
            {s.otherKeys.length ? (
              <p className="text-ink-2">
                <span className="text-ink-3">Değeri gösterilmeyen ayarlar: </span>
                <span className="font-mono">{s.otherKeys.join(', ')}</span>
              </p>
            ) : null}
          </div>
        ) : null}
      </Card>
      <div className="space-y-6">
        <Card>
          <CardHeader title="İzin kuralları" />
          <div className="space-y-3 px-5 pb-5">
            {rules.every(([, list]) => list.length === 0) ? <p className="text-ink-2">Tanımlı izin kuralı yok.</p> : null}
            {rules.filter(([, list]) => list.length).map(([label, list]) => (
              <div key={label}>
                <p className="mb-1 text-[12px] text-ink-3">{label}</p>
                <div className="flex flex-wrap gap-1.5">
                  {list.map((rule) => (
                    <code key={rule} className="rounded border border-line bg-raised px-1.5 py-0.5 font-mono text-[12px]">{rule}</code>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="Hook'lar" />
          {s.hooks.length === 0 ? (
            <p className="px-5 pb-5 text-ink-2">Tanımlı hook yok.</p>
          ) : (
            <ul className="px-5 pb-4">
              {s.hooks.map((h, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-x-2 border-t border-line py-2 text-[13px] first:border-t-0">
                  <span className="font-medium">{h.event}</span>
                  {h.matcher ? <code className="font-mono text-[12px] text-ink-2">{h.matcher}</code> : null}
                  <span className="ml-auto font-mono text-[12px] text-ink-2">{h.command}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}

// ---- shared ------------------------------------------------------------------------------------

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 focus-within:border-accent">
      <Search className="size-4 text-ink-3" aria-hidden />
      <span className="sr-only">{placeholder}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-9 w-full bg-transparent text-[14px] outline-none placeholder:text-ink-3" />
    </label>
  )
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-[52ch] text-[13px] text-ink-2">{body}</p>
    </div>
  )
}


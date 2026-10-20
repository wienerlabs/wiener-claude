import { ArrowLeft, GitPullRequest, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ProjectOption, SessionList, SessionRow, SessionSource } from '../../../shared/types.ts'
import { ErrorNote, Segmented, Skeleton, cx } from '../components/ui.tsx'
import { useApi } from '../lib/api.ts'
import { fmtDuration, fmtInt, fmtRelative, fmtUsd } from '../lib/format.ts'
import { navigate, onLinkClick, useLocation } from '../lib/router.ts'
import { Replay } from './Replay.tsx'

const PAGE = 50

export function Sessions({ selectedId }: { selectedId: string | null }) {
  const { query } = useLocation()
  const q = query.get('q') ?? ''
  const source = (query.get('kaynak') as SessionSource | null) ?? null
  const project = query.get('proje')
  const [text, setText] = useState(q)
  const [limit, setLimit] = useState(PAGE)

  const setQuery = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(query)
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    navigate(`${location.pathname}${next.size ? `?${next}` : ''}`, { replace: true })
  }

  // Search as you type, without a request per keystroke.
  useEffect(() => {
    if (text === q) return
    const id = setTimeout(() => setQuery({ q: text.trim() || null }), 250)
    return () => clearTimeout(id)
  })
  useEffect(() => setLimit(PAGE), [q, source, project])

  const params = new URLSearchParams({ limit: String(limit) })
  if (q) params.set('q', q)
  if (source) params.set('source', source)
  if (project) params.set('project', project)
  const list = useApi<SessionList>(`/api/sessions?${params}`)
  const projects = useApi<ProjectOption[]>('/api/projects')
  const keep = query.toString() ? `?${query}` : ''

  return (
    <div className="mx-auto grid max-w-[1400px] gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <section aria-label="Oturum listesi" className={cx('min-w-0 space-y-3', selectedId && 'hidden lg:block')}>
        <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em]">Oturumlar</h1>
        <label className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 focus-within:border-accent">
          <Search className="size-4 text-ink-3" aria-hidden />
          <span className="sr-only">Oturumlarda ara</span>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Başlıkta ya da istemlerde ara"
            className="h-9 w-full bg-transparent text-[14px] outline-none placeholder:text-ink-3"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented<'all' | SessionSource>
            label="Kaynak"
            value={source ?? 'all'}
            onChange={(v) => setQuery({ kaynak: v === 'all' ? null : v })}
            options={[
              { value: 'all', label: 'Tümü' },
              { value: 'desktop', label: 'Desktop' },
              { value: 'cli', label: 'CLI' },
            ]}
          />
          <select
            aria-label="Proje"
            value={project ?? ''}
            onChange={(e) => setQuery({ proje: e.target.value || null })}
            className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 text-[13px] text-ink-2"
          >
            <option value="">Bütün projeler</option>
            {projects.data?.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name} ({p.sessions})
              </option>
            ))}
          </select>
        </div>

        {list.error ? <ErrorNote message={list.error} /> : null}
        {!list.data && !list.error ? (
          <div className="space-y-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
        ) : null}
        {list.data ? (
          <>
            <p className="text-[12px] text-ink-3 num">{fmtInt(list.data.total)} oturum</p>
            {list.data.rows.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-[13px] text-ink-2">
                {q ? `"${q}" için oturum bulunamadı. Başka bir kelime dene.` : 'Bu filtrelerle eşleşen oturum yok.'}
              </p>
            ) : (
              <ul className="overflow-hidden rounded-xl border border-line bg-surface">
                {list.data.rows.map((s) => (
                  <SessionItem key={s.id} s={s} active={s.id === selectedId} href={`/oturumlar/${s.id}${keep}`} />
                ))}
              </ul>
            )}
            {list.data.rows.length < list.data.total ? (
              <button
                type="button"
                onClick={() => setLimit((l) => l + PAGE)}
                className="w-full rounded-lg border border-line bg-surface py-2 text-[13px] text-ink-2 hover:text-ink"
              >
                {Math.min(PAGE, list.data.total - list.data.rows.length)} oturum daha göster
              </button>
            ) : null}
          </>
        ) : null}
      </section>

      <section aria-label="Oturum dökümü" className={cx('min-w-0', !selectedId && 'hidden lg:block')}>
        {selectedId ? (
          <>
            <a
              href={`/oturumlar${keep}`}
              onClick={(e) => onLinkClick(e, `/oturumlar${keep}`)}
              className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink lg:hidden"
            >
              <ArrowLeft className="size-4" aria-hidden /> Bütün oturumlar
            </a>
            <Replay id={selectedId} />
          </>
        ) : (
          <div className="grid h-full min-h-[320px] place-items-center rounded-xl border border-dashed border-line text-center">
            <div className="max-w-[36ch] space-y-1 px-6">
              <p className="font-medium">Bir oturum seç</p>
              <p className="text-[13px] text-ink-2">Soldan bir oturum seçince istemler, Claude'un yanıtları ve araç çağrıları sırasıyla burada görünür.</p>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

function SessionItem({ s, active, href }: { s: SessionRow; active: boolean; href: string }) {
  return (
    <li className="border-t border-line first:border-t-0">
      <a
        href={href}
        onClick={(e) => onLinkClick(e, href)}
        aria-current={active ? 'page' : undefined}
        className={cx('block px-4 py-3 transition-colors', active ? 'bg-accent-soft' : 'hover:bg-raised')}
      >
        <span className="line-clamp-2 text-[14px] leading-snug font-medium">{s.title}</span>
        <span className="mt-1 flex flex-wrap items-center gap-x-2 text-[12px] text-ink-3">
          <span className="truncate">{s.projectName}</span>
          <span aria-hidden>·</span>
          <span>{fmtRelative(s.lastTs)}</span>
          {s.prUrl ? (
            <span className="inline-flex items-center gap-0.5" title="Bu oturumda PR açıldı">
              <GitPullRequest className="size-3" aria-hidden />
              {s.prNumber ? `#${s.prNumber}` : 'PR'}
            </span>
          ) : null}
        </span>
        <span className="mt-1 block font-mono text-[12px] text-ink-2 num">
          {fmtInt(s.messages)} mesaj · {fmtUsd(s.costEstimate)} · {fmtDuration(s.activeMs)}
          {s.toolErrors > 0 ? <span className="text-danger"> · {s.toolErrors} hata</span> : null}
        </span>
      </a>
    </li>
  )
}

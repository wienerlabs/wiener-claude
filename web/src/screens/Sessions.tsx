import { ArrowLeft, GitPullRequest, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ProjectOption, SessionList, SessionRow, SessionSource } from '../../../shared/types.ts'
import { ErrorNote, Segmented, Skeleton, cx } from '../components/ui.tsx'
import { useApi } from '../lib/api.ts'
import { fmtCount, fmtDuration, fmtRelative, fmtUsd } from '../lib/format.ts'
import { tx } from '../lib/i18n.ts'
import { RangePicker, useRange } from '../lib/range.tsx'
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
  const [range, setRange] = useRange('all')

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
  useEffect(() => setLimit(PAGE), [q, source, project, range])

  const params = new URLSearchParams({ limit: String(limit) })
  if (q) params.set('q', q)
  if (source) params.set('source', source)
  if (project) params.set('project', project)
  if (range !== 'all') params.set('range', range)
  const list = useApi<SessionList>(`/api/sessions?${params}`, { keepPrevious: true })
  const projects = useApi<ProjectOption[]>('/api/projects')
  // Keep the list's filters when opening a session, but not a previous search hit.
  const listQuery = new URLSearchParams(query)
  listQuery.delete('mesaj')
  const keep = listQuery.size ? `?${listQuery}` : ''
  const hrefFor = (s: SessionRow) => {
    const next = new URLSearchParams(listQuery)
    if (s.match) next.set('mesaj', s.match.key)
    return `/oturumlar/${s.id}${next.size ? `?${next}` : ''}`
  }
  const more = list.data ? Math.min(PAGE, list.data.total - list.data.rows.length) : 0

  return (
    <div className="mx-auto grid max-w-[1400px] gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <section
        aria-label={tx('Oturum listesi', 'Session list')}
        className={cx(
          'min-w-0 space-y-3 lg:sticky lg:top-8 lg:max-h-[calc(100vh-4rem)] lg:self-start lg:overflow-y-auto lg:pr-1',
          selectedId && 'hidden lg:block',
        )}
      >
        <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em]">{tx('Oturumlar', 'Sessions')}</h1>
        <label className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 focus-within:border-accent">
          <Search className="size-4 text-ink-3" aria-hidden />
          <span className="sr-only">{tx('Oturumlarda ara', 'Search sessions')}</span>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={tx('Başlıkta ya da konuşmalarda ara', 'Search titles and conversations')}
            className="h-9 w-full bg-transparent text-[14px] outline-none placeholder:text-ink-3"
          />
        </label>
        <RangePicker value={range} onChange={setRange} />
        <div className="flex flex-wrap items-center gap-2">
          <Segmented<'all' | SessionSource>
            label={tx('Kaynak', 'Source')}
            value={source ?? 'all'}
            onChange={(v) => setQuery({ kaynak: v === 'all' ? null : v })}
            options={[
              { value: 'all', label: tx('Tümü', 'All') },
              { value: 'desktop', label: 'Desktop' },
              { value: 'cli', label: 'CLI' },
            ]}
          />
          <select
            aria-label={tx('Proje', 'Project')}
            value={project ?? ''}
            onChange={(e) => setQuery({ proje: e.target.value || null })}
            className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 text-[13px] text-ink-2"
          >
            <option value="">{tx('Bütün projeler', 'All projects')}</option>
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
            <p className="text-[12px] text-ink-3 num">{fmtCount(list.data.total, 'oturum', 'session')}</p>
            {list.data.rows.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-[13px] text-ink-2">
                {q
                  ? tx(
                      `"${q}" için ${range === 'all' ? '' : 'bu dönemde '}oturum bulunamadı. Başka bir kelime dene.`,
                      `No sessions found for "${q}"${range === 'all' ? '' : ' in this period'}. Try another word.`,
                    )
                  : tx('Bu filtrelerle eşleşen oturum yok.', 'No sessions match these filters.')}
              </p>
            ) : (
              <ul className={cx('overflow-hidden rounded-xl border border-line bg-surface transition-opacity', list.stale && 'opacity-60')} aria-busy={list.stale}>
                {list.data.rows.map((s) => (
                  <SessionItem key={s.id} s={s} active={s.id === selectedId} href={hrefFor(s)} />
                ))}
              </ul>
            )}
            {list.data.rows.length < list.data.total ? (
              <button
                type="button"
                onClick={() => setLimit((l) => l + PAGE)}
                className="w-full rounded-lg border border-line bg-surface py-2 text-[13px] text-ink-2 hover:text-ink"
              >
                {tx(`${more} oturum daha göster`, `Show ${more} more ${more === 1 ? 'session' : 'sessions'}`)}
              </button>
            ) : null}
          </>
        ) : null}
      </section>

      <section aria-label={tx('Oturum dökümü', 'Session transcript')} className={cx('min-w-0', !selectedId && 'hidden lg:block')}>
        {selectedId ? (
          <>
            <a
              href={`/oturumlar${keep}`}
              onClick={(e) => onLinkClick(e, `/oturumlar${keep}`)}
              className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink lg:hidden"
            >
              <ArrowLeft className="size-4" aria-hidden /> {tx('Bütün oturumlar', 'All sessions')}
            </a>
            <Replay id={selectedId} focusKey={query.get('mesaj')} />
          </>
        ) : (
          <div className="grid h-full min-h-[320px] place-items-center rounded-xl border border-dashed border-line text-center">
            <div className="max-w-[36ch] space-y-1 px-6">
              <p className="font-medium">{tx('Bir oturum seç', 'Select a session')}</p>
              <p className="text-[13px] text-ink-2">
                {tx(
                  "Soldan bir oturum seçince prompt'lar, Claude'un yanıtları ve araç çağrıları sırasıyla burada görünür.",
                  "Select a session on the left to see its prompts, Claude's replies and tool calls here, in order.",
                )}
              </p>
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
            <span className="inline-flex items-center gap-0.5" title={tx('Bu oturumda PR açıldı', 'A PR was opened in this session')}>
              <GitPullRequest className="size-3" aria-hidden />
              {s.prNumber ? `#${s.prNumber}` : 'PR'}
            </span>
          ) : null}
        </span>
        <span className="mt-1 block font-mono text-[12px] text-ink-2 num">
          {fmtCount(s.messages, 'mesaj', 'message')} · {s.historyOnly ? tx('yalnızca prompt geçmişi', 'prompt history only') : `${fmtUsd(s.costEstimate)} · ${fmtDuration(s.activeMs)}`}
          {s.toolErrors > 0 ? <span className="text-danger"> · {fmtCount(s.toolErrors, 'hata', 'error')}</span> : null}
        </span>
        {s.match ? (
          <span className="mt-2 block rounded-md bg-raised px-2.5 py-1.5 text-[12px] leading-relaxed text-ink-2">
            <span className="mr-1.5 text-ink-3">{matchKind()[s.match.kind]}{s.match.hits > 1 ? tx(` · ${s.match.hits} yerde`, ` · ${s.match.hits} matches`) : ''}:</span>
            <Snippet text={s.match.snippet} />
          </span>
        ) : null}
      </a>
    </li>
  )
}

const matchKind = (): Record<NonNullable<SessionRow['match']>['kind'], string> => ({
  prompt: tx('İstemde', 'In a prompt'),
  reply: tx('Yanıtta', 'In a reply'),
  command: tx('Komutta', 'In a command'),
})

/** Renders \u0002…\u0003 hit markers as <mark>; the text itself is never parsed as HTML. */
function Snippet({ text }: { text: string }) {
  const parts: { hit: boolean; text: string }[] = []
  let hit = false
  let buf = ''
  for (const ch of text) {
    if (ch === '\u0002' || ch === '\u0003') {
      if (buf) parts.push({ hit, text: buf })
      buf = ''
      hit = ch === '\u0002'
    } else buf += ch
  }
  if (buf) parts.push({ hit, text: buf })
  return (
    <>
      {parts.map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded-[3px] bg-accent-soft px-0.5 text-accent">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  )
}

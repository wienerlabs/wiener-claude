import { ChevronRight, GitBranch, GitPullRequest, Info, Terminal, TriangleAlert, Wrench } from 'lucide-react'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ReplayItem, ReplayPage, ReplayTurn, SessionRow } from '../../../shared/types.ts'
import { ErrorNote, Skeleton, cx } from '../components/ui.tsx'
import { getJson, useDataVersion } from '../lib/api.ts'
import { fmtCompact, fmtDateTime, fmtDuration, fmtInt, fmtTime, fmtUsd, modelName } from '../lib/format.ts'

const PAGE = 25

/**
 * Loads a transcript a page of turns at a time. When the index updates, the last loaded page is
 * fetched again so a session that is still running grows in place.
 */
function useReplay(id: string) {
  const version = useDataVersion()
  const [state, setState] = useState<{ id: string; session: SessionRow | null; turns: ReplayTurn[]; total: number; missing: boolean; error: string | null }>(
    { id, session: null, turns: [], total: 0, missing: false, error: null },
  )
  const [loadingMore, setLoadingMore] = useState(false)
  const loaded = useRef(0)

  const fetchFrom = useCallback(
    async (from: number) => {
      const page = await getJson<ReplayPage>(`/api/sessions/${encodeURIComponent(id)}?from=${from}&limit=${PAGE}`)
      setState((s) => {
        const base = s.id === id ? s.turns.slice(0, from) : []
        const turns = [...base, ...page.turns]
        loaded.current = turns.length
        return { id, session: page.session, turns, total: page.totalTurns, missing: page.fileMissing, error: null }
      })
    },
    [id],
  )

  useEffect(() => {
    loaded.current = 0
    setState({ id, session: null, turns: [], total: 0, missing: false, error: null })
  }, [id])

  useEffect(() => {
    const from = loaded.current === 0 ? 0 : Math.floor((loaded.current - 1) / PAGE) * PAGE
    fetchFrom(from).catch((err: unknown) => setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err) })))
  }, [fetchFrom, version])

  const more = async () => {
    setLoadingMore(true)
    try {
      await fetchFrom(loaded.current)
    } finally {
      setLoadingMore(false)
    }
  }
  return { ...(state.id === id ? state : { session: null, turns: [], total: 0, missing: false, error: null }), more, loadingMore }
}

export function Replay({ id }: { id: string }) {
  const { session, turns, total, missing, error, more, loadingMore } = useReplay(id)
  if (error) return <ErrorNote message={error} />
  if (!session) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }
  return (
    <article className="space-y-5">
      <Header s={session} />
      {missing ? (
        <p className="flex gap-2 rounded-lg border border-line bg-raised px-4 py-3 text-[13px] text-ink-2">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          Bu oturumun dökümü artık diskte yok. Claude Code eski dökümleri bir süre sonra siler; yukarıdaki sayılar Wiener Tools'un indeksinden geliyor.
        </p>
      ) : null}
      {!missing && total === 0 ? <p className="text-ink-2">Bu oturumda henüz bir istem yok.</p> : null}
      <ol className="space-y-4">
        {turns.map((t) => (
          <Turn key={t.index} turn={t} />
        ))}
      </ol>
      {turns.length < total ? (
        <button
          type="button"
          onClick={more}
          disabled={loadingMore}
          className="w-full rounded-lg border border-line bg-surface py-2.5 text-[13px] text-ink-2 hover:text-ink"
        >
          {loadingMore ? 'Yükleniyor…' : `Sonraki ${Math.min(PAGE, total - turns.length)} turu göster (${fmtInt(total - turns.length)} kaldı)`}
        </button>
      ) : null}
    </article>
  )
}

function Header({ s }: { s: SessionRow }) {
  const hidden = s.costHidden >= 0.01 ? s.costHidden : 0
  return (
    <header className="space-y-4 rounded-xl border border-line bg-surface px-5 py-4">
      <div>
        <h1 className="font-display text-[24px] leading-tight font-semibold tracking-[-0.02em]">{s.title}</h1>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-2">
          <span>{s.projectName}</span>
          {s.gitBranch ? (
            <span className="inline-flex items-center gap-1 font-mono text-[12px]">
              <GitBranch className="size-3.5" aria-hidden />
              {s.gitBranch}
            </span>
          ) : null}
          <span>{s.source === 'desktop' ? 'Desktop' : s.source === 'cli' ? 'CLI' : 'Diğer'}</span>
          <span>{s.models.map(modelName).join(', ')}</span>
          <span className="num">{fmtDateTime(s.firstTs)} → {fmtDateTime(s.lastTs)}</span>
          {s.prUrl ? (
            <a href={s.prUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent underline underline-offset-2">
              <GitPullRequest className="size-3.5" aria-hidden />
              {s.prNumber ? `PR #${s.prNumber}` : 'PR'}
            </a>
          ) : null}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <Stat label="Aktif süre" value={fmtDuration(s.activeMs)} />
        <Stat label="Mesaj" value={fmtInt(s.messages)} note={`${fmtInt(s.prompts)} istem`} />
        <Stat
          label="Araç çağrısı"
          value={fmtInt(s.toolCalls)}
          note={s.toolErrors ? <span className="text-danger">{s.toolErrors} hata</span> : 'hatasız'}
        />
        <Stat
          label="Maliyet"
          value={fmtUsd(s.costEstimate + hidden)}
          note={hidden ? `${fmtUsd(s.costEstimate)} dökümde + ${fmtUsd(hidden)} kayıtsız` : 'tahmini liste fiyatı'}
        />
      </dl>
      {s.linesAdded !== null ? (
        <p className="font-mono text-[12px] text-ink-2 num">
          <span className="text-good">+{fmtInt(s.linesAdded)}</span> <span className="text-danger">−{fmtInt(s.linesRemoved ?? 0)}</span> satır
        </p>
      ) : null}
      {hidden ? (
        <p className="flex gap-2 border-t border-line pt-3 text-[12px] text-ink-2">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            Claude Code'un kendi sayacı bu oturum için dökümde görünenden {fmtUsd(hidden)} fazla harcama gösteriyor. Fark, dökümlere yazılmayan
            çağrılardan geliyor; bunlar büyük olasılıkla başlık üretimi ya da izin denetimi gibi arka plan görevleri.
          </span>
        </p>
      ) : null}
    </header>
  )
}

function Stat({ label, value, note }: { label: string; value: string; note?: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[12px] text-ink-3">{label}</dt>
      <dd className="font-display text-[20px] font-semibold tracking-[-0.01em] num">{value}</dd>
      {note ? <dd className="text-[12px] text-ink-2">{note}</dd> : null}
    </div>
  )
}

const Turn = memo(function Turn({ turn }: { turn: ReplayTurn }) {
  return (
    <li className="grid grid-cols-[3rem_minmax(0,1fr)] gap-3">
      <time className="pt-2.5 text-right font-mono text-[12px] text-ink-3 num">{fmtTime(turn.ts)}</time>
      <div className="min-w-0 space-y-2">
        {turn.prompt ? <Prompt p={turn.prompt} /> : null}
        {turn.items.map((item, i) => (
          <Item key={i} item={item} />
        ))}
        {turn.cost > 0 || turn.toolCalls > 0 || turn.errors > 0 ? (
          <p className="pl-1 font-mono text-[11px] text-ink-3 num">
            {fmtUsd(turn.cost)} · {fmtCompact(turn.outputTokens)} çıktı token
            {turn.toolCalls ? ` · ${turn.toolCalls} araç` : ''}
            {turn.errors ? <span className="text-danger"> · {turn.errors} hata</span> : null}
          </p>
        ) : null}
      </div>
    </li>
  )
})

function Prompt({ p }: { p: NonNullable<ReplayTurn['prompt']> }) {
  const [open, setOpen] = useState(false)
  const long = p.text.length > 600
  const shown = long && !open ? `${p.text.slice(0, 600)}…` : p.text
  return (
    <div className="rounded-lg bg-accent-soft px-4 py-3">
      <div className={cx('whitespace-pre-wrap text-[14px] leading-relaxed', p.kind !== 'prompt' && 'font-mono text-[13px]')}>
        {p.kind === 'bash' ? <Terminal className="mr-1.5 inline size-3.5 align-[-2px]" aria-hidden /> : null}
        {shown}
      </div>
      {p.images ? <p className="mt-1 text-[12px] text-ink-2">{p.images} görsel eklendi</p> : null}
      {long ? (
        <button type="button" onClick={() => setOpen(!open)} className="mt-1 text-[12px] text-accent underline underline-offset-2">
          {open ? 'Kısalt' : 'Tamamını göster'}
        </button>
      ) : null}
    </div>
  )
}

function Item({ item }: { item: ReplayItem }) {
  switch (item.type) {
    case 'text':
      return (
        <div className="md px-1 text-[14px] leading-relaxed">
          <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{ a: (props) => <a {...props} target="_blank" rel="noreferrer" /> }}>
            {item.text}
          </ReactMarkdown>
        </div>
      )
    case 'thinking':
      return (
        <details className="group px-1 text-[13px] text-ink-2">
          <summary className="flex cursor-pointer list-none items-center gap-1 text-ink-3 hover:text-ink-2">
            <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden />
            Düşünce özeti{item.durationMs && item.durationMs >= 1000 ? ` · ${fmtDuration(item.durationMs)}` : ''}
          </summary>
          <p className="mt-1 whitespace-pre-wrap pl-5">{item.text}</p>
        </details>
      )
    case 'tool':
      return <ToolCall item={item} />
    case 'compact':
      return (
        <div className="flex items-center gap-3 py-1 text-[12px] text-ink-3" role="separator">
          <span className="h-px flex-1 bg-line" />
          Bağlam özetlendi{item.preTokens ? ` · ${fmtCompact(item.preTokens)} token` : ''}
          {item.trigger === 'manual' ? ' · elle' : item.trigger === 'auto' ? ' · otomatik' : ''}
          <span className="h-px flex-1 bg-line" />
        </div>
      )
    case 'notice':
      return (
        <p className={cx('flex items-start gap-1.5 px-1 text-[13px]', item.tone === 'error' ? 'text-danger' : 'text-ink-3')}>
          {item.tone === 'error' ? <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden /> : null}
          <span className="line-clamp-3">{item.text}</span>
        </p>
      )
  }
}

function ToolCall({ item }: { item: Extract<ReplayItem, { type: 'tool' }> }) {
  const failed = item.result?.isError && !item.result.denied
  const denied = item.result?.denied
  const name = item.name.startsWith('mcp__') ? item.name.split('__').slice(1).join(' › ') : item.name
  return (
    <details className={cx('group rounded-lg border bg-surface', failed ? 'border-danger/40' : 'border-line')}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-1.5 text-[13px]">
        <ChevronRight className="size-3.5 shrink-0 text-ink-3 transition-transform group-open:rotate-90" aria-hidden />
        <Wrench className="size-3.5 shrink-0 text-ink-3" aria-hidden />
        <span className="shrink-0 font-mono text-[12px] font-medium">{name}</span>
        <span className="min-w-0 truncate font-mono text-[12px] text-ink-2">{item.summary}</span>
        <span className="ml-auto shrink-0 text-[11px]">
          {failed ? <span className="text-danger">hata</span> : denied ? <span className="text-ink-3">reddedildi</span> : item.result ? null : <span className="text-ink-3">yanıt yok</span>}
        </span>
      </summary>
      <div className="space-y-2 border-t border-line px-3 py-2">
        <Block label="Girdi" text={item.input} />
        {item.result ? <Block label={failed ? 'Hata' : 'Sonuç'} text={item.result.text || '(boş)'} danger={!!failed} /> : null}
      </div>
    </details>
  )
}

function Block({ label, text, danger }: { label: string; text: string; danger?: boolean }) {
  return (
    <div>
      <div className="mb-0.5 text-[11px] text-ink-3">{label}</div>
      <pre className={cx('max-h-72 overflow-auto rounded-md bg-raised px-2.5 py-2 font-mono text-[12px] whitespace-pre-wrap', danger && 'text-danger')}>{text}</pre>
    </div>
  )
}

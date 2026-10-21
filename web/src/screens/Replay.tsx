import { ChevronRight, GitBranch, GitPullRequest, Info, Terminal, TriangleAlert, Wrench } from 'lucide-react'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ReplayItem, ReplayPage, ReplayTurn, SessionRow } from '../../../shared/types.ts'
import { ErrorNote, Skeleton, cx } from '../components/ui.tsx'
import { getJson, useAccount, useDataVersion } from '../lib/api.ts'
import { fmtCompact, fmtCount, fmtDateTime, fmtDuration, fmtInt, fmtTime, fmtUsd, modelName } from '../lib/format.ts'
import { tx } from '../lib/i18n.ts'

const PAGE = 25

interface ReplayState {
  key: string
  session: SessionRow | null
  /** Index of turns[0] in the whole transcript; a search hit can open mid-session. */
  start: number
  turns: ReplayTurn[]
  total: number
  focusTurn: number | null
  missing: boolean
  error: string | null
}

const empty = (key: string): ReplayState => ({ key, session: null, start: 0, turns: [], total: 0, focusTurn: null, missing: false, error: null })

/**
 * Loads a transcript a page of turns at a time, starting at the first turn or at a search hit.
 * When the index updates, the last loaded page is fetched again so a running session grows in place.
 */
function useReplay(id: string, focusKey: string | null) {
  const [account] = useAccount()
  const key = `${account ?? ''}|${id}|${focusKey ?? ''}`
  const version = useDataVersion()
  const [state, setState] = useState<ReplayState>(() => empty(key))
  const [busy, setBusy] = useState(false)
  const current = useRef(state)
  current.current = state

  const url = useCallback(
    (params: Record<string, string | number>) =>
      `/api/sessions/${encodeURIComponent(id)}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}`,
    [id],
  )
  const fail = (err: unknown) => setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err) }))

  // First page: the beginning, or the page around the hit.
  useEffect(() => {
    setState(empty(key))
    const params: Record<string, string | number> = focusKey ? { around: focusKey, limit: PAGE } : { from: 0, limit: PAGE }
    getJson<ReplayPage>(url(params)).then(
      (page) => setState({ key, session: page.session, start: page.from, turns: page.turns, total: page.totalTurns, focusTurn: page.focusTurn, missing: page.fileMissing, error: null }),
      fail,
    )
  }, [key, focusKey, url])

  // Live updates: refetch the tail that is on screen.
  const firstVersion = useRef(version)
  useEffect(() => {
    if (version === firstVersion.current) return
    const s = current.current
    if (!s.session || s.key !== key) return
    const from = Math.max(s.start, s.start + s.turns.length - PAGE)
    getJson<ReplayPage>(url({ from, limit: PAGE })).then((page) => {
      setState((prev) => {
        if (prev.key !== key) return prev
        const keep = prev.turns.slice(0, from - prev.start)
        return { ...prev, session: page.session, turns: [...keep, ...page.turns], total: page.totalTurns, missing: page.fileMissing }
      })
    }, () => {})
  }, [version, key, url])

  const load = async (direction: 'before' | 'after') => {
    const s = current.current
    setBusy(true)
    try {
      if (direction === 'after') {
        const from = s.start + s.turns.length
        const page = await getJson<ReplayPage>(url({ from, limit: PAGE }))
        setState((prev) => (prev.key === key ? { ...prev, turns: [...prev.turns, ...page.turns], total: page.totalTurns } : prev))
      } else {
        const from = Math.max(0, s.start - PAGE)
        const page = await getJson<ReplayPage>(url({ from, limit: s.start - from }))
        setState((prev) => (prev.key === key ? { ...prev, start: from, turns: [...page.turns, ...prev.turns] } : prev))
      }
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }
  return { ...(state.key === key ? state : empty(key)), load, busy }
}

export function Replay({ id, focusKey = null }: { id: string; focusKey?: string | null }) {
  const { session, start, turns, total, focusTurn, missing, error, load, busy } = useReplay(id, focusKey)
  const scrolled = useRef<string | null>(null)

  // Bring a search hit into view once, after its page has rendered.
  useEffect(() => {
    if (focusTurn === null || !session) return
    const marker = `${id}|${focusKey}`
    if (scrolled.current === marker) return
    const el = (focusKey && document.getElementById(`item-${focusKey}`)) || document.getElementById(`turn-${focusTurn}`)
    if (el) {
      el.scrollIntoView({ block: 'center' })
      scrolled.current = marker
    }
  }, [focusTurn, session, id, focusKey, turns.length])

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
  const remaining = total - (start + turns.length)
  return (
    <article className="space-y-5">
      <Header s={session} />
      {missing ? (
        <p className="flex gap-2 rounded-lg border border-line bg-raised px-4 py-3 text-[13px] text-ink-2">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          {tx(
            "Bu oturumun dökümü artık diskte yok. Claude Code eski dökümleri bir süre sonra siler; yukarıdaki sayılar Wiener Tools'un indeksinden geliyor.",
            "This session's transcript is no longer on disk. Claude Code deletes old transcripts after a while, so the numbers above come from the Wiener Tools index.",
          )}
        </p>
      ) : null}
      {!missing && total === 0 ? <p className="text-ink-2">{tx('Bu oturumda henüz bir prompt yok.', 'No prompts in this session yet.')}</p> : null}
      {focusKey && focusTurn === null && !missing && total > 0 ? (
        <p className="text-[13px] text-ink-2">
          {tx(
            'Aranan mesaj bu dökümde bulunamadı; oturum baştan gösteriliyor.',
            "The message you searched for isn't in this transcript, so the session is shown from the start.",
          )}
        </p>
      ) : null}
      {start > 0 ? (
        <button type="button" onClick={() => load('before')} disabled={busy} className="w-full rounded-lg border border-line bg-surface py-2.5 text-[13px] text-ink-2 hover:text-ink">
          {busy
            ? tx('Yükleniyor…', 'Loading…')
            : tx(
                `Önceki ${Math.min(PAGE, start)} turu göster (${fmtInt(start)} tur önce)`,
                `Show previous ${fmtCount(Math.min(PAGE, start), 'tur', 'turn')} (${fmtInt(start)} earlier)`,
              )}
        </button>
      ) : null}
      <ol className="space-y-4">
        {turns.map((t) => (
          <Turn key={t.index} turn={t} focused={t.index === focusTurn} focusKey={t.index === focusTurn ? focusKey : null} />
        ))}
      </ol>
      {remaining > 0 ? (
        <button type="button" onClick={() => load('after')} disabled={busy} className="w-full rounded-lg border border-line bg-surface py-2.5 text-[13px] text-ink-2 hover:text-ink">
          {busy
            ? tx('Yükleniyor…', 'Loading…')
            : tx(
                `Sonraki ${Math.min(PAGE, remaining)} turu göster (${fmtInt(remaining)} kaldı)`,
                `Show next ${fmtCount(Math.min(PAGE, remaining), 'tur', 'turn')} (${fmtInt(remaining)} left)`,
              )}
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
          <span>{s.source === 'desktop' ? 'Desktop' : s.source === 'cli' ? 'CLI' : tx('Diğer', 'Other')}</span>
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
        <Stat label={tx('Aktif süre', 'Active time')} value={fmtDuration(s.activeMs)} />
        <Stat label={tx('Mesaj', 'Messages')} value={fmtInt(s.messages)} note={fmtCount(s.prompts, 'prompt', 'prompt')} />
        <Stat
          label={tx('Araç çağrısı', 'Tool calls')}
          value={fmtInt(s.toolCalls)}
          note={s.toolErrors ? <span className="text-danger">{fmtCount(s.toolErrors, 'hata', 'error')}</span> : tx('hatasız', 'no errors')}
        />
        <Stat
          label={tx('Maliyet', 'Cost')}
          value={fmtUsd(s.costEstimate + hidden)}
          note={
            hidden
              ? tx(`${fmtUsd(s.costEstimate)} dökümde + ${fmtUsd(hidden)} kayıtsız`, `${fmtUsd(s.costEstimate)} in transcript + ${fmtUsd(hidden)} unrecorded`)
              : tx('tahmini liste fiyatı', 'estimated at list price')
          }
        />
      </dl>
      {s.linesAdded !== null ? (
        <p className="font-mono text-[12px] text-ink-2 num">
          <span className="text-good">+{fmtInt(s.linesAdded)}</span> <span className="text-danger">−{fmtInt(s.linesRemoved ?? 0)}</span> {tx('satır', 'lines')}
        </p>
      ) : null}
      {hidden ? (
        <p className="flex gap-2 border-t border-line pt-3 text-[12px] text-ink-2">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            {tx(
              <>
                Claude Code'un kendi sayacı bu oturum için dökümde görünenden {fmtUsd(hidden)} fazla harcama gösteriyor. Fark, dökümlere yazılmayan
                çağrılardan geliyor; bunlar büyük olasılıkla başlık üretimi ya da izin denetimi gibi arka plan görevleri.
              </>,
              <>
                Claude Code's own counter shows {fmtUsd(hidden)} more spend for this session than the transcript does. The difference comes from
                calls that aren't written to transcripts, most likely background tasks such as generating titles or checking permissions.
              </>,
            )}
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

const Turn = memo(function Turn({ turn, focused, focusKey }: { turn: ReplayTurn; focused: boolean; focusKey: string | null }) {
  return (
    <li id={`turn-${turn.index}`} className="grid scroll-mt-6 grid-cols-[3rem_minmax(0,1fr)] gap-3" aria-current={focused ? 'true' : undefined}>
      <time className={cx('pt-2.5 text-right font-mono text-[12px] num', focused ? 'font-medium text-accent' : 'text-ink-3')}>{fmtTime(turn.ts)}</time>
      <div className="min-w-0 space-y-2">
        {turn.prompt ? (
          <Hit id={turn.prompt.key} focusKey={focusKey}>
            <Prompt p={turn.prompt} />
          </Hit>
        ) : null}
        {turn.items.map((item, i) => (
          <Hit key={i} id={item.type === 'text' ? item.key : item.type === 'tool' ? item.id : null} focusKey={focusKey}>
            <Item item={item} open={item.type === 'tool' && item.id === focusKey} />
          </Hit>
        ))}
        {turn.cost > 0 || turn.toolCalls > 0 || turn.errors > 0 ? (
          <p className="pl-1 font-mono text-[11px] text-ink-3 num">
            {fmtUsd(turn.cost)} · {tx(`${fmtCompact(turn.outputTokens)} output token`, `${fmtCompact(turn.outputTokens)} output tokens`)}
            {turn.toolCalls ? ` · ${fmtCount(turn.toolCalls, 'araç', 'tool call')}` : ''}
            {turn.errors ? <span className="text-danger"> · {fmtCount(turn.errors, 'hata', 'error')}</span> : null}
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
      {p.images ? <p className="mt-1 text-[12px] text-ink-2">{fmtCount(p.images, 'görsel', 'image')} {tx('eklendi', 'attached')}</p> : null}
      {long ? (
        <button type="button" onClick={() => setOpen(!open)} className="mt-1 text-[12px] text-accent underline underline-offset-2">
          {open ? tx('Kısalt', 'Show less') : tx('Tamamını göster', 'Show all')}
        </button>
      ) : null}
    </div>
  )
}

/** Anchors a replay element so a search hit can scroll to it, and rings the one that matched. */
function Hit({ id, focusKey, children }: { id: string | null; focusKey: string | null; children: React.ReactNode }) {
  if (!id) return <>{children}</>
  const hit = id === focusKey
  return (
    <div id={`item-${id}`} className={cx('scroll-mt-6 rounded-lg', hit && 'bg-accent-soft/60 shadow-[0_0_0_2px_var(--accent)]')}>
      {children}
    </div>
  )
}

function Item({ item, open = false }: { item: ReplayItem; open?: boolean }) {
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
            {tx('Düşünce özeti', 'Thinking summary')}
            {item.durationMs && item.durationMs >= 1000 ? ` · ${fmtDuration(item.durationMs)}` : ''}
          </summary>
          <p className="mt-1 whitespace-pre-wrap pl-5">{item.text}</p>
        </details>
      )
    case 'tool':
      return <ToolCall item={item} open={open} />
    case 'compact':
      return (
        <div className="flex items-center gap-3 py-1 text-[12px] text-ink-3" role="separator">
          <span className="h-px flex-1 bg-line" />
          {tx('Compact: konuşma özetlendi', 'Compact: conversation summarized')}
          {item.preTokens ? tx(` · ${fmtCompact(item.preTokens)} token`, ` · ${fmtCompact(item.preTokens)} tokens`) : ''}
          {item.trigger === 'manual' ? tx(' · elle', ' · manual') : item.trigger === 'auto' ? tx(' · otomatik', ' · automatic') : ''}
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

function ToolCall({ item, open }: { item: Extract<ReplayItem, { type: 'tool' }>; open: boolean }) {
  const failed = item.result?.isError && !item.result.denied
  const denied = item.result?.denied
  const name = item.name.startsWith('mcp__') ? item.name.split('__').slice(1).join(' › ') : item.name
  return (
    <details open={open || undefined} className={cx('group rounded-lg border bg-surface', failed ? 'border-danger/40' : 'border-line')}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-1.5 text-[13px]">
        <ChevronRight className="size-3.5 shrink-0 text-ink-3 transition-transform group-open:rotate-90" aria-hidden />
        <Wrench className="size-3.5 shrink-0 text-ink-3" aria-hidden />
        <span className="shrink-0 font-mono text-[12px] font-medium">{name}</span>
        <span className="min-w-0 truncate font-mono text-[12px] text-ink-2">{item.summary}</span>
        <span className="ml-auto shrink-0 text-[11px]">
          {failed ? (
            <span className="text-danger">{tx('hata', 'error')}</span>
          ) : denied ? (
            <span className="text-ink-3">{tx('reddedildi', 'denied')}</span>
          ) : item.result ? null : (
            <span className="text-ink-3">{tx('yanıt yok', 'no result')}</span>
          )}
        </span>
      </summary>
      <div className="space-y-2 border-t border-line px-3 py-2">
        <Block label="Input" text={item.input} />
        {item.result ? (
          <Block label={failed ? tx('Hata', 'Error') : tx('Sonuç', 'Result')} text={item.result.text || tx('(boş)', '(empty)')} danger={!!failed} />
        ) : null}
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

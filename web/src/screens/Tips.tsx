import { Check, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Tip, TipsReport } from '../../../shared/types.ts'
import { savingText } from '../components/TipLinks.tsx'
import { Card, ErrorNote, Skeleton, cx } from '../components/ui.tsx'
import { useApi } from '../lib/api.ts'
import { tx } from '../lib/i18n.ts'
import { RangePicker, rangeSpan, useRange } from '../lib/range.tsx'
import { onLinkClick } from '../lib/router.ts'

export function Tips() {
  const [range, setRange] = useRange('30d')
  const { data, error, stale } = useApi<TipsReport>(`/api/tips?range=${range}`, { keepPrevious: true })

  // Links from other screens point at one tip: /ipuclari#context.
  const loaded = data !== null
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1))
    if (loaded && id) document.getElementById(id)?.scrollIntoView({ block: 'start' })
  }, [loaded])

  return (
    <div className="mx-auto max-w-[920px] space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em]">{tx('İpuçları', 'Tips')}</h1>
          <p className="max-w-[60ch] text-[14px] text-ink-2">
            {tx(
              "Transcript'lerinden çıkan öneriler, dayandıkları oturumlarla birlikte. Hepsi bu bilgisayarda, kurallarla hesaplanır; hiçbir şey dışarı gönderilmez.",
              'Suggestions drawn from your transcripts, along with the sessions behind them. Everything is rule-based and computed on this computer; nothing is sent anywhere.',
            )}
          </p>
        </div>
        <RangePicker value={range} onChange={setRange} />
      </header>

      {error ? <ErrorNote message={error} /> : null}
      {!data && !error ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-48 w-full" />)}
        </div>
      ) : null}

      {data ? (
        <div className={cx('space-y-5 transition-opacity', stale && 'opacity-60')} aria-busy={stale}>
          {data.tips.length === 0 ? (
            <Card>
              <p className="px-5 py-5 text-ink-2">
                {tx(
                  `${rangeSpan(range)} öne çıkan bir ipucu yok. Kullanım arttıkça burada öneriler belirir.`,
                  `${rangeSpan(range)}, no tips stand out. Suggestions will show up here as you use Claude Code more.`,
                )}
              </p>
            </Card>
          ) : (
            data.tips.map((t) => <TipCard key={t.kind} tip={t} />)
          )}
          {data.tips.some((t) => t.saving !== null) ? (
            <p className="text-[12px] text-ink-3">
              {tx(
                'Tahminler liste fiyatıyla hesaplanır ve birbiriyle örtüşebilir (örneğin context şişmesi ile cache yeniden yazımı aynı çağrılara dokunur), bu yüzden toplanmamalı.',
                "Estimates use list prices and can overlap (context bloat and cache rewrites, for example, affect the same calls), so don't add them up.",
              )}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function TipCard({ tip }: { tip: Tip }) {
  const saving = savingText(tip)
  return (
    <section id={tip.kind} className="scroll-mt-6 rounded-xl border border-line bg-surface">
      <div className="space-y-3 px-5 pt-4 pb-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="font-display text-[19px] font-semibold tracking-[-0.01em]">{tip.title}</h2>
          {saving ? <span className="rounded-full bg-good/10 px-2.5 py-0.5 text-[12px] font-medium text-good num">{saving}</span> : null}
        </div>
        <p className="text-[14px]">{tip.finding}</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <h3 className="text-[12px] text-ink-3">{tx('Neden önemli', 'Why it matters')}</h3>
            <p className="text-[13px] text-ink-2">{tip.why}</p>
          </div>
          <div>
            <h3 className="text-[12px] text-ink-3">{tx('Ne yapabilirsin', 'What you can do')}</h3>
            <p className="text-[13px] text-ink-2">{tip.action}</p>
          </div>
        </div>
      </div>

      {tip.examples.length ? (
        <div className="border-t border-line px-5 py-3">
          <h3 className="pb-1 text-[12px] text-ink-3">{tx('Dayandığı örnekler', 'Supporting examples')}</h3>
          <ul>
            {tip.examples.map((e, i) => (
              <li key={`${e.label}-${i}`} className="flex flex-col py-1 text-[13px] sm:flex-row sm:items-baseline sm:gap-3">
                {e.sessionId ? (
                  <a
                    href={`/oturumlar/${e.sessionId}`}
                    onClick={(ev) => onLinkClick(ev, `/oturumlar/${e.sessionId}`)}
                    className="min-w-0 truncate text-accent hover:underline hover:underline-offset-2 sm:flex-1"
                    title={e.label}
                  >
                    {e.label}
                  </a>
                ) : (
                  <span className={cx('min-w-0 truncate sm:flex-1', e.mono && 'font-mono text-[12px]')} title={e.label}>
                    {e.label}
                  </span>
                )}
                <span className="text-[12px] text-ink-2 num sm:shrink-0 sm:text-right">{e.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tip.snippet ? <Snippet label={tip.snippet.label} code={tip.snippet.code} /> : null}
    </section>
  )
}

export function Snippet({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard blocked; the text is still there to select by hand.
    }
  }
  return (
    <div className="border-t border-line px-5 py-3">
      <div className="flex items-center justify-between gap-3 pb-1.5">
        <h3 className="truncate font-mono text-[12px] text-ink-3">{label}</h3>
        <button type="button" onClick={copy} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-ink-2 hover:bg-raised hover:text-ink">
          {copied ? <Check className="size-3.5 text-good" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          {copied ? tx('Kopyalandı', 'Copied') : tx('Kopyala', 'Copy')}
        </button>
      </div>
      <pre className="overflow-x-auto rounded-lg bg-raised px-3 py-2 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-ink">{code}</pre>
    </div>
  )
}

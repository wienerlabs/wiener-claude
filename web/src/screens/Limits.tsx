import { CircleGauge } from 'lucide-react'
import { withPossessive } from '../../../shared/tr.ts'
import type { LimitHit, Limits as LimitsReport, Summary, WindowForecast } from '../../../shared/types.ts'
import { Card, CardHeader, ErrorNote, Skeleton, cx } from '../components/ui.tsx'
import { useApi } from '../lib/api.ts'
import { DEMO } from '../lib/demo.ts'
import { fmtCount, fmtDateTime, fmtDuration, fmtRelative, fmtTime, fmtUsd } from '../lib/format.ts'
import { tx } from '../lib/i18n.ts'
import { onLinkClick } from '../lib/router.ts'
import { promptsLeft } from './Overview.tsx'
import { Snippet } from './Tips.tsx'

const pct = (v: number) => tx(`%${Math.round(v)}`, `${Math.round(v)}%`)

export function Limits() {
  const { data, error } = useApi<LimitsReport>('/api/limits')
  const summary = useApi<Summary>('/api/summary')
  return (
    <div className="mx-auto max-w-[1180px] space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em]">{tx('Limitler', 'Limits')}</h1>
          <p className="max-w-[72ch] text-[14px] text-ink-2">
            {tx(
              '5 saatlik ve haftalık limitlerin ne kadar dolu, bu hızla ne zaman dolar ve dolmadan önce ne kadar iş sığar. Bilgisayarındaki ölçümlerden ve kayıtlardan hesaplanır; hiçbir şey dışarı gönderilmez.',
              'How full your 5-hour and weekly limits are, when they fill at your current pace, and how much work still fits. Worked out from the readings and records on this computer; nothing is sent anywhere.',
            )}
          </p>
        </div>
        {data?.plan ? <span className="rounded-md border border-line px-2 py-1 text-[12px] text-ink-2">Plan: {data.plan}</span> : null}
      </header>

      {error ? <ErrorNote message={error} /> : null}
      {!data && !error ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
          <Skeleton className="h-32 w-full" />
        </div>
      ) : null}
      {data ? (
        <>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <WindowCard kind="five_hour" w={data.forecast.fiveHour} />
            <WindowCard kind="seven_day" w={data.forecast.sevenDay} />
          </div>
          {data.forecast.fiveHour || data.forecast.sevenDay ? (
            <p className="-mt-3 text-[12px] text-ink-3">{readingNote((data.forecast.fiveHour ?? data.forecast.sevenDay) as WindowForecast)}</p>
          ) : !DEMO ? (
            <ReadingsSetup />
          ) : null}

          <OpenSessions live={summary.data?.live ?? null} />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <CurrentWindow l={data} />
            <LastSevenDays l={data} />
          </div>

          {data.hits.length ? <Hits hits={data.hits} /> : null}
        </>
      ) : null}
    </div>
  )
}

/** One limit: how full it is, when it resets, where it is heading and what still fits. */
function WindowCard({ kind, w }: { kind: 'five_hour' | 'seven_day'; w: WindowForecast | null }) {
  const five = kind === 'five_hour'
  const title = five ? tx('5 saatlik pencere', '5-hour limit') : tx('Haftalık limit', 'Weekly limit')
  if (!w) {
    return (
      <Card>
        <CardHeader title={title} />
        <p className="px-5 pb-5 text-[13px] text-ink-2">{tx('Bu limit için henüz bir ölçüm yok.', 'No reading for this limit yet.')}</p>
      </Card>
    )
  }
  const when = (ts: number) => (five ? fmtTime(ts) : fmtDateTime(ts))
  const outlook =
    w.fillsAt !== null
      ? tx(`Bu hızla ${when(w.fillsAt)} civarında dolar.`, `At this pace it fills around ${when(w.fillsAt)}.`)
      : w.atReset !== null
        ? tx(`Bu hızla sıfırlanmadan dolmaz; sıfırlanırken yaklaşık ${pct(w.atReset)} olur.`, `At this pace it won't fill before it resets; it would reach about ${pct(w.atReset)}.`)
        : w.pace === 0
          ? tx('Şu an kullanılmıyor.', 'Nothing is using it right now.')
          : null
  return (
    <Card>
      <CardHeader title={title} aside={w.estimated ? tx('tahmini', 'estimated') : tx('ölçülen', 'measured')} />
      <div className="space-y-3 px-5 pb-5">
        <p className="font-display text-[40px] leading-none font-semibold tracking-[-0.03em] num">{pct(w.percent)}</p>
        <div className="h-2.5 overflow-hidden rounded-full bg-line/60">
          <div className={cx('h-full rounded-full', w.percent >= 90 ? 'bg-danger' : 'bg-[var(--heat-3)]')} style={{ width: `${Math.min(100, w.percent)}%` }} />
        </div>
        <dl className="space-y-1 text-[13px]">
          {w.resetsAt ? (
            <div className="flex justify-between gap-3">
              <dt className="text-ink-3">{tx('Sıfırlanma', 'Resets')}</dt>
              <dd className="num">{fmtDateTime(w.resetsAt)}</dd>
            </div>
          ) : null}
          {w.leftUsd !== null ? (
            <div className="flex justify-between gap-3">
              <dt className="text-ink-3">{tx('Dolmadan önce sığacak iş', 'Work that still fits')}</dt>
              <dd className="num">{tx(`~${fmtUsd(w.leftUsd)} (liste fiyatı)`, `~${fmtUsd(w.leftUsd)} at list price`)}</dd>
            </div>
          ) : null}
        </dl>
        {outlook ? <p className="text-[14px] text-ink">{outlook}</p> : null}
      </div>
    </Card>
  )
}

/** Where the reading the numbers rest on came from, and how old it is. */
function readingNote(w: WindowForecast): string {
  const from = {
    desktop: tx('Desktop uygulamasının ölçümü', "The desktop app's reading"),
    statusline: tx("Status line'ın ölçümü", "The status line's reading"),
    account: tx("Claude Code'un ölçümü", "Claude Code's reading"),
  }[w.source]
  return w.estimated
    ? tx(
        `${from} ${fmtRelative(w.measuredAt)}; o zamandan beri yerel kayıtlardaki harcamayla güncellendi. claude.ai sohbetleri bu tahmine girmez.`,
        `${from}, ${fmtRelative(w.measuredAt)}, carried forward with what was spent since in local records. claude.ai chats aren't part of the estimate.`,
      )
    : tx(`${from}, ${fmtRelative(w.measuredAt)}.`, `${from}, ${fmtRelative(w.measuredAt)}.`)
}

/** Until any usage reading arrives: the desktop app saves them on its own; the terminal needs the status line. */
function ReadingsSetup() {
  const { data } = useApi<{ command: string; configured: boolean }>('/api/statusline')
  if (!data) return null
  return (
    <Card>
      <CardHeader title={tx('Limit ölçümleri', 'Usage readings')} />
      <div className="px-5 pb-1">
        <p className="max-w-[80ch] text-[13px] text-ink-2">
          {data.configured
            ? tx(
                "Status line ayarlı. Claude Code'un bir sonraki yanıtından sonra ölçümler burada görünür. Claude Code bu ölçümleri yalnızca Pro ve Max planlarında verir.",
                "The status line is set up. Readings show up here after Claude Code's next response. Claude Code only provides them on Pro and Max plans.",
              )
            : tx(
                "Henüz limit ölçümü yok. Claude Desktop kullanıyorsan ölçümler uygulama açıkken kendiliğinden gelir; panel yüzdeyi, limitin bu hızla ne zaman dolacağını ve açık oturumların kaç prompt'luk payı kaldığını gösterir. Yalnızca terminalde çalışıyorsan aşağıdaki satırı ~/.claude/settings.json dosyasına ekle; Claude Code her yanıttan sonra ölçümü buraya bildirir. Ölçümler bu bilgisayarda kalır.",
                "No usage readings yet. If you use Claude Desktop, they come in on their own while the app is open, and the dashboard shows the percentage, when the limit fills at your current pace, and how many prompts your open sessions have left. If you only work in the terminal, add the line below to ~/.claude/settings.json and Claude Code reports a reading after every response. The readings stay on this computer.",
              )}
        </p>
        {!data.configured ? (
          <p className="mt-1 pb-2 text-[12px] text-ink-3">
            {tx(
              "Kendi status line'ın varsa komutun sonuna -- ve kendi komutunu ekle: ölçüm kaydedilir, ekranda seninki görünür.",
              'If you already have a status line, add -- and your own command at the end: the reading is recorded and yours is what you see.',
            )}
          </p>
        ) : null}
      </div>
      {!data.configured ? <Snippet label="~/.claude/settings.json" code={`"statusLine": { "type": "command", "command": "${data.command}" }`} /> : <div className="pb-4" />}
    </Card>
  )
}

/** Running sessions, with roughly how many prompts like their recent ones they have left. */
function OpenSessions({ live }: { live: Summary['live'] | null }) {
  const withForecast = live?.filter((l) => l.forecast) ?? []
  if (!withForecast.length) return null
  return (
    <Card>
      <CardHeader
        title={tx('Açık oturumlar', 'Open sessions')}
        aside={tx('her biri tek başına bu hızla gitse', 'if each went on alone at this pace')}
      />
      <ul className="px-5 pb-4">
        {withForecast.map((l) => (
          <li key={l.sessionId} className="border-t border-line first:border-t-0">
            <a href={`/oturumlar/${l.sessionId}`} onClick={(e) => onLinkClick(e, `/oturumlar/${l.sessionId}`)} className="group flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5">
              <span className="min-w-0">
                <span className="block truncate group-hover:underline group-hover:underline-offset-2">{l.title ?? tx('Adsız oturum', 'Untitled session')}</span>
                <span className="text-[12px] text-ink-3">
                  {l.projectName ?? tx('Bilinmeyen proje', 'Unknown project')}
                  {l.forecast ? ` · ${tx(`prompt başına ~${fmtUsd(l.forecast.perPrompt)}`, `~${fmtUsd(l.forecast.perPrompt)} a prompt`)}` : ''}
                </span>
              </span>
              <span className="text-[13px] text-ink-2">{l.forecast ? promptsLeft(l.forecast) : null}</span>
            </a>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function CurrentWindow({ l }: { l: LimitsReport }) {
  const now = Date.now()
  return (
    <Card>
      <CardHeader title={tx('Şu anki 5 saatlik pencere', 'Current 5-hour window')} aside={tx('yerel kayıtlardan', 'from local records')} />
      <div className="px-5 pb-5">
        {l.block ? (
          <>
            <p className="font-display text-[22px] font-semibold num">{fmtUsd(l.block.cost)}</p>
            <p className="text-[13px] text-ink-2 num">
              {fmtTime(l.block.start)}–{fmtTime(l.block.end)} · {fmtCount(l.block.messages, 'mesaj', 'message')} ·{' '}
              {tx(`${fmtDuration(l.block.end - now)} kaldı`, `${fmtDuration(l.block.end - now)} left`)}
            </p>
            <p className="mt-1 text-[12px] text-ink-3">
              {tx(
                'Pencere, aradan sonraki ilk isteğin saatinde başlar; yerel kayıtlardan tahmin edilir.',
                "The window starts on the hour of your first request after a break. It's estimated from local records.",
              )}
            </p>
          </>
        ) : (
          <p className="text-[13px] text-ink-2">
            {tx('Son 5 saatte istek yok; bir sonraki istekle yeni pencere açılır.', 'No requests in the last 5 hours. Your next request opens a new window.')}
          </p>
        )}
      </div>
    </Card>
  )
}

function LastSevenDays({ l }: { l: LimitsReport }) {
  const atHit = l.rolling7.atLastWeeklyHit
  const ratio = atHit && atHit.cost > 0 ? l.rolling7.cost / atHit.cost : null
  return (
    <Card>
      <CardHeader title={tx('Son 7 gün', 'Last 7 days')} aside={tx('yerel kayıtlardan', 'from local records')} />
      <div className="px-5 pb-5">
        <p className="font-display text-[22px] font-semibold num">{fmtUsd(l.rolling7.cost)}</p>
        {atHit ? (
          <>
            <p className="text-[13px] text-ink-2">
              {tx(
                `Haftalık limit en son ${fmtDateTime(atHit.at)} tarihinde doldu; o an son 7 günde ${fmtUsd(atHit.cost)} harcamıştın.`,
                `You last hit the weekly limit on ${fmtDateTime(atHit.at)}, after using ${fmtUsd(atHit.cost)} over the previous 7 days.`,
              )}
            </p>
            {ratio !== null ? (
              <div className="mt-2">
                <div className="h-2 overflow-hidden rounded-full bg-line/60">
                  <div className="h-full rounded-full bg-[var(--heat-3)]" style={{ width: `${Math.min(100, ratio * 100)}%` }} />
                </div>
                <p className="mt-1 text-[12px] text-ink-3 num">
                  {tx(
                    `O seviyenin ${withPossessive(ratio * 100, '%')}. Limitin kesin yüzdesi değil, bir karşılaştırma.`,
                    `${Math.round(ratio * 100)}% of that level. This is a comparison, not your exact limit percentage.`,
                  )}
                </p>
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-[13px] text-ink-2">{tx('Kayıtlarda dolmuş bir haftalık limit yok.', "You haven't hit the weekly limit in the recorded history.")}</p>
        )}
      </div>
    </Card>
  )
}

function hitLabel(kind: LimitHit['kind']): string {
  return {
    five_hour: tx('5 saatlik limit doldu', '5-hour limit reached'),
    seven_day: tx('Haftalık limit doldu', 'Weekly limit reached'),
    other: tx('Limit doldu', 'Limit reached'),
  }[kind]
}

function Hits({ hits }: { hits: LimitHit[] }) {
  return (
    <Card>
      <CardHeader title={tx('Limitin dolduğu anlar', 'Times you hit a limit')} />
      <ul className="space-y-1.5 px-5 pb-5">
        {hits.map((h) => (
          <li key={`${h.kind}-${h.at}`} className="flex flex-wrap items-baseline gap-x-3 text-[13px]">
            <CircleGauge className="size-3.5 self-center text-ink-3" aria-hidden />
            <span className="font-medium">{hitLabel(h.kind)}</span>
            <span className="font-mono text-[12px] text-ink-2 num">{fmtDateTime(h.at)}</span>
            {h.resetsAt ? (
              <span className="text-[12px] text-ink-3">
                {tx(
                  `açıldı ${fmtDateTime(h.resetsAt)} · ${fmtDuration(h.resetsAt - h.at)} bekleme`,
                  `reset ${fmtDateTime(h.resetsAt)} · ${fmtDuration(h.resetsAt - h.at)} wait`,
                )}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  )
}

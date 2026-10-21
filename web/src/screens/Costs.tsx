import { CircleGauge, Info } from 'lucide-react'
import { useState } from 'react'
import { withPossessive } from '../../../shared/tr.ts'
import type { CostReport, LimitHit, Limits, RangeKey, TipsReport } from '../../../shared/types.ts'
import { DailyBars, HBars, ShareBar } from '../components/charts.tsx'
import { TipLinks } from '../components/TipLinks.tsx'
import { Card, CardHeader, ErrorNote, Skeleton, cx } from '../components/ui.tsx'
import { refreshNow, useApi, withLang } from '../lib/api.ts'
import { DEMO } from '../lib/demo.ts'
import { fmtCount, fmtDateTime, fmtDayLong, fmtDayShort, fmtDuration, fmtMetric, fmtRelative, fmtTime, fmtUsd, modelName } from '../lib/format.ts'
import { getLang, tx } from '../lib/i18n.ts'
import { RangePicker, rangeSpan, useRange } from '../lib/range.tsx'

function periodText(key: RangeKey): { label: string; lower: string; compare: (change: string) => string } {
  return {
    week: {
      label: tx('Bu hafta', 'This week'),
      lower: tx('bu hafta', 'this week'),
      compare: (change: string) => tx(`geçen haftanın aynı günlerine göre ${change}`, `${change} vs. the same days last week`),
    },
    '30d': {
      label: tx('Son 30 gün', 'Last 30 days'),
      lower: tx('son 30 gün', 'last 30 days'),
      compare: (change: string) => tx(`önceki 30 güne göre ${change}`, `${change} vs. the previous 30 days`),
    },
    all: { label: tx('Tüm zamanlar', 'All time'), lower: tx('tüm zamanlar', 'all time'), compare: (change: string) => change },
  }[key]
}

export function Costs() {
  const [range, setRange] = useRange('30d')
  const { data, error, stale } = useApi<CostReport>(`/api/costs?range=${range}`, { keepPrevious: true })
  if (error) return <div className="mx-auto max-w-[1180px]"><ErrorNote message={error} /></div>
  if (!data) {
    return (
      <div className="mx-auto max-w-[1180px] space-y-6">
        <Skeleton className="h-12 w-1/2" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    )
  }
  const m = data.month
  const period = periodText(data.range.key)
  const delta = data.previous !== null && data.previous > 0 ? Math.round(((data.total - data.previous) / data.previous) * 100) : null
  const deltaText = delta === null ? null : period.compare(`${delta >= 0 ? '+' : '−'}${tx(`%${Math.abs(delta)}`, `${Math.abs(delta)}%`)}`)

  return (
    <div className={cx('mx-auto max-w-[1180px] space-y-6 transition-opacity', stale && 'opacity-60')} aria-busy={stale}>
      <header className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="font-display text-[34px] leading-[1.1] font-semibold tracking-[-0.03em] sm:text-[44px]">
            <span className="text-ink-2">{rangeSpan(data.range.key)} </span>
            <span className="num">{fmtUsd(data.total)}</span>
          </h1>
          <RangePicker value={range} onChange={setRange} />
        </div>
        <p className="max-w-[72ch] text-[15px] text-ink-2">
          {data.range.key === 'all'
            ? tx(`İlk kayıt ${fmtDayLong(data.range.from)}. `, `Your history starts on ${fmtDayLong(data.range.from)}. `)
            : deltaText ? `${capitalize(deltaText)}. ` : ''}
          {tx(
            `Bu ay şu ana kadar ${fmtUsd(m.cost)}; bu hızla ay sonunda yaklaşık ${fmtUsd(m.projected)}.`,
            `${fmtUsd(m.cost)} so far this month. At this pace, you'll end the month at about ${fmtUsd(m.projected)}.`,
          )}
          {' '}
          {tx(
            'Tutarlar liste fiyatıyla hesaplanır; abonelikte ödediğin ücret değil, kullanımının API karşılığıdır.',
            'Amounts use list prices: what your usage would cost on the API, not what you pay for your subscription.',
          )}
        </p>
      </header>

      <dl className="grid grid-cols-2 overflow-hidden rounded-xl border border-line bg-surface lg:grid-cols-4">
        <Stat
          label={period.label}
          value={fmtUsd(data.total)}
          note={
            deltaText ??
            (data.range.key === 'all'
              ? fmtCount(data.range.days, 'günlük kayıt', 'day of history', 'days of history')
              : tx('karşılaştırılacak önceki kayıt yok', 'no earlier period to compare with'))
          }
        />
        <Stat
          label={tx('Ay sonu tahmini', 'Month-end projection')}
          value={fmtUsd(m.projected)}
          note={tx(`bu ay şu ana kadar ${fmtUsd(m.cost)}`, `${fmtUsd(m.cost)} so far this month`)}
          className="border-l border-line"
        />
        <Stat
          label={tx('Cache tasarrufu', 'Cache savings')}
          value={fmtUsd(data.cacheSavings)}
          note={tx('cache olmasaydı bu kadar fazla tutardı', 'how much more it would have cost without cache')}
          className="border-t border-line lg:border-t-0 lg:border-l"
        />
        <Stat
          label={tx('Dökümde görünmeyen', 'Missing from transcripts')}
          value={fmtUsd(data.hidden)}
          note={tx('Claude Code sayacının dökümü aştığı kısım', "where Claude Code's own counter runs ahead of the transcripts")}
          className="border-t border-l border-line lg:border-t-0"
        />
      </dl>

      <BudgetCard report={data} />

      <Card>
        <CardHeader title={period.label} aside={data.series.bucket === 'week' ? tx('haftalık tahmini maliyet', 'estimated cost per week') : tx('günlük tahmini maliyet', 'estimated cost per day')} />
        <div className="px-5 pt-2 pb-4">
          <DailyBars data={data.series.points} bucket={data.series.bucket} />
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={tx('Para nereye gidiyor', 'Where the money goes')} aside={tx(`${period.lower}, token türüne göre`, `${period.lower}, by token type`)} />
          <div className="px-5 pb-5">
            <ShareBar
              format={fmtUsd}
              parts={[
                { label: tx("Cache'ten okuma", 'Cache read'), value: data.mix.cacheRead, color: 'var(--cat-1)', detail: data.tokens ? fmtMetric('tokens', data.tokens.cacheRead) : undefined },
                { label: tx("Cache'e yazma", 'Cache write'), value: data.mix.cacheWrite, color: 'var(--cat-2)', detail: data.tokens ? fmtMetric('tokens', data.tokens.cacheWrite) : undefined },
                { label: 'Output', value: data.mix.output, color: 'var(--cat-3)', detail: data.tokens ? fmtMetric('tokens', data.tokens.output) : undefined },
                { label: 'Input', value: data.mix.input, color: 'var(--cat-4)', detail: data.tokens ? fmtMetric('tokens', data.tokens.input) : undefined },
              ]}
            />
            <p className="mt-4 text-[12px] text-ink-3">
              {tx(
                "Her istekte konuşmanın tamamı cache'ten yeniden okunur; uzun oturumlarda maliyetin çoğu bu yüzden cache okumasından gelir.",
                'Every request reads the whole conversation back from cache, which is why cache reads make up most of the cost in long sessions.',
              )}
            </p>
          </div>
        </Card>
        <Card>
          <CardHeader title={tx('Model bazında', 'By model')} aside={period.lower} />
          <div className="px-5 pb-5">
            {data.models.length ? (
              <HBars
                format={fmtUsd}
                items={data.models.map((x) => ({ label: modelName(x.model), value: x.cost, note: tx(`%${Math.round(x.share * 100)}`, `${Math.round(x.share * 100)}%`) }))}
              />
            ) : (
              <p className="text-ink-2">{tx('Bu dönemde kayıt yok.', 'Nothing recorded in this period.')}</p>
            )}
          </div>
        </Card>
      </div>

      <LimitsCard l={data.limits} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={tx('Projeler', 'Projects')} aside={tx(`${period.lower}, en çok harcayanlar`, `${period.lower}, top spenders`)} />
          <div className="px-5 pb-5">
            {data.projects.length ? (
              <HBars format={fmtUsd} items={data.projects.map((p) => ({ label: p.name, value: p.cost }))} />
            ) : (
              <p className="text-ink-2">{tx('Bu dönemde kayıt yok.', 'Nothing recorded in this period.')}</p>
            )}
          </div>
        </Card>
        <SavingTips range={data.range.key} />
      </div>
    </div>
  )
}

/** The İpuçları that are about money, for the range on screen. */
function SavingTips({ range }: { range: RangeKey }) {
  const { data } = useApi<TipsReport>(`/api/tips?range=${range}`, { keepPrevious: true })
  return (
    <Card>
      <CardHeader title={tx('Tasarruf ipuçları', 'Cost-saving tips')} aside={periodText(range).lower} />
      {data ? (
        <TipLinks
          tips={data.tips.filter((t) => t.saving !== null)}
          range={range}
          empty={tx('Bu dönemde belirgin bir tasarruf fırsatı görünmüyor.', 'No clear ways to save in this period.')}
        />
      ) : (
        <div className="px-5 pb-5">
          <Skeleton className="h-16 w-full" />
        </div>
      )}
    </Card>
  )
}

const capitalize = (t: string) => t.charAt(0).toLocaleUpperCase(getLang()) + t.slice(1)

function Stat({ label, value, note, className }: { label: string; value: string; note: string; className?: string }) {
  return (
    <div className={cx('px-5 py-4', className)}>
      <dt className="text-[12px] text-ink-3">{label}</dt>
      <dd className="mt-0.5 font-display text-[26px] leading-tight font-semibold tracking-[-0.02em] num">{value}</dd>
      <dd className="mt-0.5 text-[12px] text-ink-2">{note}</dd>
    </div>
  )
}

function hitLabel(kind: LimitHit['kind']): string {
  return {
    five_hour: tx('5 saatlik limit doldu', '5-hour limit reached'),
    seven_day: tx('Haftalık limit doldu', 'Weekly limit reached'),
    other: tx('Limit doldu', 'Limit reached'),
  }[kind]
}

function LimitsCard({ l }: { l: Limits }) {
  const now = Date.now()
  const atHit = l.rolling7.atLastWeeklyHit
  const ratio = atHit && atHit.cost > 0 ? l.rolling7.cost / atHit.cost : null
  return (
    <Card>
      <CardHeader title={tx('Limitler', 'Usage limits')} aside={l.plan ? `Plan: ${l.plan}` : null} />
      <div className="grid grid-cols-1 gap-6 px-5 pb-5 lg:grid-cols-3">
        <section>
          <h3 className="text-[12px] text-ink-3">{tx("Claude Code'un ölçümü", 'Measured by Claude Code')}</h3>
          {l.measured?.fresh ? (
            <div className="mt-2 space-y-3">
              {l.measured.fiveHour ? <Meter label={tx('5 saatlik pencere', '5-hour limit')} percent={l.measured.fiveHour.percent} resetsAt={l.measured.fiveHour.resetsAt} /> : null}
              {l.measured.sevenDay ? <Meter label={tx('Haftalık', 'Weekly limit')} percent={l.measured.sevenDay.percent} resetsAt={l.measured.sevenDay.resetsAt} /> : null}
              <p className="text-[12px] text-ink-3">{tx(`${fmtRelative(l.measured.fetchedAt)} ölçüldü.`, `Measured ${fmtRelative(l.measured.fetchedAt)}.`)}</p>
            </div>
          ) : (
            <p className="mt-2 flex gap-2 text-[13px] text-ink-2">
              <Info className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
              {l.measured
                ? tx(
                    `Son ölçüm ${fmtRelative(l.measured.fetchedAt)}; güncel pencereyi anlatmadığı için yüzde gösterilmiyor. Terminalde /usage çalıştırınca yenilenir.`,
                    `Last measured ${fmtRelative(l.measured.fetchedAt)}. That reading doesn't cover the current window, so no percentage is shown. Run /usage in your terminal to refresh it.`,
                  )
                : tx(
                    'Claude Code bu bilgisayarda henüz bir limit ölçümü kaydetmemiş. Terminalde /usage çalıştırınca görünür.',
                    "Claude Code hasn't recorded a usage limit reading on this computer yet. Run /usage in your terminal and it will show up here.",
                  )}
            </p>
          )}
        </section>

        <section>
          <h3 className="text-[12px] text-ink-3">{tx('Şu anki 5 saatlik pencere', 'Current 5-hour window')}</h3>
          {l.block ? (
            <div className="mt-2">
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
            </div>
          ) : (
            <p className="mt-2 text-[13px] text-ink-2">
              {tx('Son 5 saatte istek yok; bir sonraki istekle yeni pencere açılır.', 'No requests in the last 5 hours. Your next request opens a new window.')}
            </p>
          )}
        </section>

        <section>
          <h3 className="text-[12px] text-ink-3">{tx('Son 7 gün', 'Last 7 days')}</h3>
          <p className="mt-2 font-display text-[22px] font-semibold num">{fmtUsd(l.rolling7.cost)}</p>
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
                  <div className="relative h-2 overflow-visible rounded-full bg-line/60">
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
        </section>
      </div>

      {l.hits.length ? (
        <div className="border-t border-line px-5 py-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-[12px] text-ink-3">
            <CircleGauge className="size-3.5" aria-hidden /> {tx('Limitin dolduğu anlar', 'Times you hit a limit')}
          </h3>
          <ul className="space-y-1.5">
            {l.hits.map((h) => (
              <li key={`${h.kind}-${h.at}`} className="flex flex-wrap items-baseline gap-x-3 text-[13px]">
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
        </div>
      ) : null}
    </Card>
  )
}

function Meter({ label, percent, resetsAt }: { label: string; percent: number; resetsAt: number | null }) {
  return (
    <div>
      <div className="flex justify-between text-[13px]">
        <span>{label}</span>
        <span className="font-mono num">{tx(`%${Math.round(percent)}`, `${Math.round(percent)}%`)}</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-line/60">
        <div className={cx('h-full rounded-full', percent >= 90 ? 'bg-danger' : 'bg-[var(--heat-3)]')} style={{ width: `${Math.min(100, percent)}%` }} />
      </div>
      {resetsAt ? <p className="mt-0.5 text-[12px] text-ink-3">{tx(`${fmtDateTime(resetsAt)} sıfırlanır`, `Resets ${fmtDateTime(resetsAt)}`)}</p> : null}
    </div>
  )
}

function BudgetCard({ report }: { report: CostReport }) {
  const budget = report.budget
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const save = async (monthlyBudget: number | null) => {
    setSaving(true)
    setError(null)
    try {
      if (DEMO) {
        throw new Error(
          tx(
            'Demoda bütçe kaydedilmez. Kendi panelinde npx wiener-tools-claude ile dene.',
            "The demo doesn't save budgets. Try it on your own dashboard with npx wiener-tools-claude.",
          ),
        )
      }
      const res = await fetch(withLang('/api/settings'), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ monthlyBudget }),
      })
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? tx('Kaydedilemedi', "Couldn't save"))
      setEditing(false)
      refreshNow()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    // Turkish writes "1.000,50", English "1,000.50".
    const plain = tx(value.replace(/\./g, '').replace(',', '.'), value.replace(/,/g, ''))
    const amount = Number(plain.replace(/[^\d.]/g, ''))
    if (!value.trim() || !Number.isFinite(amount) || amount <= 0) {
      setError(tx('Sıfırdan büyük bir tutar gir, örneğin 500', 'Enter an amount greater than zero, like 500'))
      return
    }
    void save(amount)
  }

  const form = (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <label className="flex h-9 items-center gap-1 rounded-lg border border-line bg-surface px-3 focus-within:border-accent">
        <span className="text-ink-3">$</span>
        <span className="sr-only">{tx('Aylık bütçe (dolar)', 'Monthly budget (USD)')}</span>
        <input
          inputMode="decimal"
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setError(null)
          }}
          placeholder="500"
          className="w-28 bg-transparent font-mono text-[14px] outline-none placeholder:text-ink-3"
          autoFocus={editing}
        />
      </label>
      <button type="submit" disabled={saving} className="h-9 rounded-lg bg-accent px-4 text-[13px] font-medium text-white disabled:opacity-60 dark:text-bg">
        {saving ? tx('Kaydediliyor…', 'Saving…') : tx('Bütçeyi kaydet', 'Save budget')}
      </button>
      {budget ? (
        <button type="button" onClick={() => setEditing(false)} className="h-9 rounded-lg px-3 text-[13px] text-ink-2 hover:text-ink">
          {tx('Vazgeç', 'Cancel')}
        </button>
      ) : null}
      {error ? <p role="alert" className="w-full text-[13px] text-danger">{error}</p> : null}
    </form>
  )

  if (!budget || editing) {
    return (
      <Card>
        <CardHeader title={tx('Aylık bütçe', 'Monthly budget')} />
        <div className="space-y-2 px-5 pb-5">
          {!budget ? (
            <p className="text-[13px] text-ink-2">
              {tx(
                "Bir tutar belirlersen, bu hızla ne zaman aşacağını burada ve Genel bakış'ta görürsün. Tutar liste fiyatı üzerinden karşılaştırılır.",
                "Set an amount to see, here and on Overview, when you're on pace to go over it. It's compared against cost at list prices.",
              )}
            </p>
          ) : null}
          {form}
        </div>
      </Card>
    )
  }

  const m = report.month
  const used = m.cost / budget.monthly
  const projected = m.projected / budget.monthly
  const over = m.cost >= budget.monthly
  const barLabel = tx(
    `Bütçenin ${withPossessive(used * 100, '%')} kullanıldı, ay sonu tahmini %${Math.round(projected * 100)}`,
    `${Math.round(used * 100)}% of budget used, ${Math.round(projected * 100)}% projected by month end`,
  )
  return (
    <Card>
      <CardHeader
        title={tx('Aylık bütçe', 'Monthly budget')}
        aside={
          <span className="flex gap-3">
            <button type="button" onClick={() => { setValue(String(budget.monthly)); setEditing(true) }} className="text-accent hover:underline">{tx('Değiştir', 'Edit')}</button>
            <button type="button" onClick={() => void save(null)} className="text-ink-3 hover:text-ink">{tx('Kaldır', 'Remove')}</button>
          </span>
        }
      />
      <div className="px-5 pb-5">
        <p className="text-[14px]">
          <span className="font-display text-[22px] font-semibold num">{fmtUsd(m.cost)}</span>
          <span className="text-ink-2"> / {fmtUsd(budget.monthly)}</span>
        </p>
        <div className="relative mt-2 h-2.5 rounded-full bg-line/60" role="img" aria-label={barLabel}>
          <div className={cx('h-full rounded-full', over ? 'bg-danger' : 'bg-[var(--heat-3)]')} style={{ width: `${Math.min(100, used * 100)}%` }} />
          {/* The projection, as a tick where the month would end at today's pace. */}
          <span className="absolute top-[-3px] h-4 w-0.5 rounded-full bg-ink" style={{ left: `calc(${Math.min(100, projected * 100)}% - 1px)` }} aria-hidden />
        </div>
        <p className={cx('mt-2 text-[13px]', over || budget.crossesOn ? 'text-danger' : 'text-ink-2')}>
          {over
            ? tx(
                `Bütçe ${budget.crossesOn ? fmtDayShort(budget.crossesOn) : 'bu ay'} tarihinde aşıldı.`,
                budget.crossesOn ? `You went over budget on ${fmtDayShort(budget.crossesOn)}.` : 'You went over budget this month.',
              )
            : budget.crossesOn
              ? tx(
                  `Bu hızla ay sonunda yaklaşık ${fmtUsd(m.projected)}; bütçe ${fmtDayShort(budget.crossesOn)} tarihinde aşılır.`,
                  `At this pace, you'll end the month at about ${fmtUsd(m.projected)} and go over budget on ${fmtDayShort(budget.crossesOn)}.`,
                )
              : tx(
                  `Bu hızla ay sonunda yaklaşık ${fmtUsd(m.projected)}; bütçenin içinde kalıyorsun.`,
                  `At this pace, you'll end the month at about ${fmtUsd(m.projected)}, within budget.`,
                )}
        </p>
        <p className="mt-1 text-[12px] text-ink-3">{tx('Çizgi, bugünkü hızla ayın nerede biteceğini gösterir.', "The marker shows where you'll end the month at today's pace.")}</p>
        {error ? <p role="alert" className="mt-2 text-[13px] text-danger">{error}</p> : null}
      </div>
    </Card>
  )
}

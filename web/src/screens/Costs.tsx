import { CircleGauge, Info } from 'lucide-react'
import { useState } from 'react'
import { withPossessive } from '../../../shared/tr.ts'
import type { CostReport, LimitHit, Limits, RangeKey, TipsReport } from '../../../shared/types.ts'
import { DailyBars, HBars, ShareBar } from '../components/charts.tsx'
import { TipLinks } from '../components/TipLinks.tsx'
import { Card, CardHeader, ErrorNote, Skeleton, cx } from '../components/ui.tsx'
import { refreshNow, useApi } from '../lib/api.ts'
import { fmtCompact, fmtDateTime, fmtDayLong, fmtDayShort, fmtDuration, fmtInt, fmtRelative, fmtTime, fmtUsd, modelName } from '../lib/format.ts'
import { RangePicker, rangeSpan, useRange } from '../lib/range.tsx'

const PERIOD: Record<RangeKey, { label: string; lower: string; compare: string }> = {
  week: { label: 'Bu hafta', lower: 'bu hafta', compare: 'geçen haftanın aynı günlerine göre' },
  '30d': { label: 'Son 30 gün', lower: 'son 30 gün', compare: 'önceki 30 güne göre' },
  all: { label: 'Tüm zamanlar', lower: 'tüm zamanlar', compare: '' },
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
  const period = PERIOD[data.range.key]
  const delta = data.previous !== null && data.previous > 0 ? Math.round(((data.total - data.previous) / data.previous) * 100) : null
  const deltaText = delta === null ? null : `${period.compare} ${delta >= 0 ? '+' : '−'}%${Math.abs(delta)}`

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
          {data.range.key === 'all' ? `İlk kayıt ${fmtDayLong(data.range.from)}. ` : deltaText ? `${capitalize(deltaText)}. ` : ''}
          Bu ay şu ana kadar {fmtUsd(m.cost)}; bu hızla ay sonunda yaklaşık {fmtUsd(m.projected)}.
          {' '}Tutarlar liste fiyatıyla hesaplanır; abonelikte ödediğin ücret değil, kullanımının API karşılığıdır.
        </p>
      </header>

      <dl className="grid grid-cols-2 overflow-hidden rounded-xl border border-line bg-surface lg:grid-cols-4">
        <Stat
          label={period.label}
          value={fmtUsd(data.total)}
          note={deltaText ?? (data.range.key === 'all' ? `${fmtInt(data.range.days)} günlük kayıt` : 'karşılaştırılacak önceki kayıt yok')}
        />
        <Stat label="Ay sonu tahmini" value={fmtUsd(m.projected)} note={`bu ay şu ana kadar ${fmtUsd(m.cost)}`} className="border-l border-line" />
        <Stat label="Cache tasarrufu" value={fmtUsd(data.cacheSavings)} note="cache olmasaydı bu kadar fazla tutardı" className="border-t border-line lg:border-t-0 lg:border-l" />
        <Stat
          label="Dökümde görünmeyen"
          value={fmtUsd(data.hidden)}
          note="Claude Code sayacının dökümü aştığı kısım"
          className="border-t border-l border-line lg:border-t-0"
        />
      </dl>

      <BudgetCard report={data} />

      <Card>
        <CardHeader title={period.label} aside={data.series.bucket === 'week' ? 'haftalık tahmini maliyet' : 'günlük tahmini maliyet'} />
        <div className="px-5 pt-2 pb-4">
          <DailyBars data={data.series.points} bucket={data.series.bucket} />
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Para nereye gidiyor" aside={`${period.lower}, token türüne göre`} />
          <div className="px-5 pb-5">
            <ShareBar
              format={fmtUsd}
              parts={[
                { label: "Cache'ten okuma", value: data.mix.cacheRead, color: 'var(--cat-1)', detail: data.tokens ? `${fmtCompact(data.tokens.cacheRead)} token` : undefined },
                { label: "Cache'e yazma", value: data.mix.cacheWrite, color: 'var(--cat-2)', detail: data.tokens ? `${fmtCompact(data.tokens.cacheWrite)} token` : undefined },
                { label: 'Output', value: data.mix.output, color: 'var(--cat-3)', detail: data.tokens ? `${fmtCompact(data.tokens.output)} token` : undefined },
                { label: 'Input', value: data.mix.input, color: 'var(--cat-4)', detail: data.tokens ? `${fmtCompact(data.tokens.input)} token` : undefined },
              ]}
            />
            <p className="mt-4 text-[12px] text-ink-3">
              Her istekte konuşmanın tamamı cache'ten yeniden okunur; uzun oturumlarda maliyetin çoğu bu yüzden cache okumasından gelir.
            </p>
          </div>
        </Card>
        <Card>
          <CardHeader title="Model bazında" aside={period.lower} />
          <div className="px-5 pb-5">
            {data.models.length ? (
              <HBars
                format={fmtUsd}
                items={data.models.map((x) => ({ label: modelName(x.model), value: x.cost, note: `%${Math.round(x.share * 100)}` }))}
              />
            ) : (
              <p className="text-ink-2">Bu dönemde kayıt yok.</p>
            )}
          </div>
        </Card>
      </div>

      <LimitsCard l={data.limits} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Projeler" aside={`${period.lower}, en çok harcayanlar`} />
          <div className="px-5 pb-5">
            {data.projects.length ? (
              <HBars format={fmtUsd} items={data.projects.map((p) => ({ label: p.name, value: p.cost }))} />
            ) : (
              <p className="text-ink-2">Bu dönemde kayıt yok.</p>
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
      <CardHeader title="Tasarruf ipuçları" aside={PERIOD[range].lower} />
      {data ? (
        <TipLinks tips={data.tips.filter((t) => t.saving !== null)} range={range} empty="Bu dönemde belirgin bir tasarruf fırsatı görünmüyor." />
      ) : (
        <div className="px-5 pb-5">
          <Skeleton className="h-16 w-full" />
        </div>
      )}
    </Card>
  )
}

const capitalize = (t: string) => t.charAt(0).toLocaleUpperCase('tr') + t.slice(1)

function Stat({ label, value, note, className }: { label: string; value: string; note: string; className?: string }) {
  return (
    <div className={cx('px-5 py-4', className)}>
      <dt className="text-[12px] text-ink-3">{label}</dt>
      <dd className="mt-0.5 font-display text-[26px] leading-tight font-semibold tracking-[-0.02em] num">{value}</dd>
      <dd className="mt-0.5 text-[12px] text-ink-2">{note}</dd>
    </div>
  )
}

const HIT_LABEL: Record<LimitHit['kind'], string> = {
  five_hour: '5 saatlik limit doldu',
  seven_day: 'Haftalık limit doldu',
  other: 'Limit doldu',
}

function LimitsCard({ l }: { l: Limits }) {
  const now = Date.now()
  const atHit = l.rolling7.atLastWeeklyHit
  const ratio = atHit && atHit.cost > 0 ? l.rolling7.cost / atHit.cost : null
  return (
    <Card>
      <CardHeader title="Limitler" aside={l.plan ? `Plan: ${l.plan}` : null} />
      <div className="grid grid-cols-1 gap-6 px-5 pb-5 lg:grid-cols-3">
        <section>
          <h3 className="text-[12px] text-ink-3">Claude Code'un ölçümü</h3>
          {l.measured?.fresh ? (
            <div className="mt-2 space-y-3">
              {l.measured.fiveHour ? <Meter label="5 saatlik pencere" percent={l.measured.fiveHour.percent} resetsAt={l.measured.fiveHour.resetsAt} /> : null}
              {l.measured.sevenDay ? <Meter label="Haftalık" percent={l.measured.sevenDay.percent} resetsAt={l.measured.sevenDay.resetsAt} /> : null}
              <p className="text-[12px] text-ink-3">{fmtRelative(l.measured.fetchedAt)} ölçüldü.</p>
            </div>
          ) : (
            <p className="mt-2 flex gap-2 text-[13px] text-ink-2">
              <Info className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
              {l.measured
                ? `Son ölçüm ${fmtRelative(l.measured.fetchedAt)}; güncel pencereyi anlatmadığı için yüzde gösterilmiyor. Terminalde /usage çalıştırınca yenilenir.`
                : 'Claude Code bu bilgisayarda henüz bir limit ölçümü kaydetmemiş. Terminalde /usage çalıştırınca görünür.'}
            </p>
          )}
        </section>

        <section>
          <h3 className="text-[12px] text-ink-3">Şu anki 5 saatlik pencere</h3>
          {l.block ? (
            <div className="mt-2">
              <p className="font-display text-[22px] font-semibold num">{fmtUsd(l.block.cost)}</p>
              <p className="text-[13px] text-ink-2 num">
                {fmtTime(l.block.start)}–{fmtTime(l.block.end)} · {fmtInt(l.block.messages)} mesaj · {fmtDuration(l.block.end - now)} kaldı
              </p>
              <p className="mt-1 text-[12px] text-ink-3">Pencere, aradan sonraki ilk isteğin saatinde başlar; yerel kayıtlardan tahmin edilir.</p>
            </div>
          ) : (
            <p className="mt-2 text-[13px] text-ink-2">Son 5 saatte istek yok; bir sonraki istekle yeni pencere açılır.</p>
          )}
        </section>

        <section>
          <h3 className="text-[12px] text-ink-3">Son 7 gün</h3>
          <p className="mt-2 font-display text-[22px] font-semibold num">{fmtUsd(l.rolling7.cost)}</p>
          {atHit ? (
            <>
              <p className="text-[13px] text-ink-2">
                Haftalık limit en son {fmtDateTime(atHit.at)} tarihinde doldu; o an son 7 günde {fmtUsd(atHit.cost)} harcamıştın.
              </p>
              {ratio !== null ? (
                <div className="mt-2">
                  <div className="relative h-2 overflow-visible rounded-full bg-line/60">
                    <div className="h-full rounded-full bg-[var(--heat-3)]" style={{ width: `${Math.min(100, ratio * 100)}%` }} />
                  </div>
                  <p className="mt-1 text-[12px] text-ink-3 num">O seviyenin {withPossessive(ratio * 100, '%')}. Limitin kesin yüzdesi değil, bir karşılaştırma.</p>
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-[13px] text-ink-2">Kayıtlarda dolmuş bir haftalık limit yok.</p>
          )}
        </section>
      </div>

      {l.hits.length ? (
        <div className="border-t border-line px-5 py-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-[12px] text-ink-3">
            <CircleGauge className="size-3.5" aria-hidden /> Limitin dolduğu anlar
          </h3>
          <ul className="space-y-1.5">
            {l.hits.map((h) => (
              <li key={`${h.kind}-${h.at}`} className="flex flex-wrap items-baseline gap-x-3 text-[13px]">
                <span className="font-medium">{HIT_LABEL[h.kind]}</span>
                <span className="font-mono text-[12px] text-ink-2 num">{fmtDateTime(h.at)}</span>
                {h.resetsAt ? <span className="text-[12px] text-ink-3">açıldı {fmtDateTime(h.resetsAt)} · {fmtDuration(h.resetsAt - h.at)} bekleme</span> : null}
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
        <span className="font-mono num">%{Math.round(percent)}</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-line/60">
        <div className={cx('h-full rounded-full', percent >= 90 ? 'bg-danger' : 'bg-[var(--heat-3)]')} style={{ width: `${Math.min(100, percent)}%` }} />
      </div>
      {resetsAt ? <p className="mt-0.5 text-[12px] text-ink-3">{fmtDateTime(resetsAt)} sıfırlanır</p> : null}
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
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ monthlyBudget }),
      })
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? 'Kaydedilemedi')
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
    const amount = Number(value.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, ''))
    if (!value.trim() || !Number.isFinite(amount) || amount <= 0) {
      setError('Sıfırdan büyük bir tutar gir, örneğin 500')
      return
    }
    void save(amount)
  }

  const form = (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <label className="flex h-9 items-center gap-1 rounded-lg border border-line bg-surface px-3 focus-within:border-accent">
        <span className="text-ink-3">$</span>
        <span className="sr-only">Aylık bütçe (dolar)</span>
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
        {saving ? 'Kaydediliyor…' : 'Bütçeyi kaydet'}
      </button>
      {budget ? (
        <button type="button" onClick={() => setEditing(false)} className="h-9 rounded-lg px-3 text-[13px] text-ink-2 hover:text-ink">
          Vazgeç
        </button>
      ) : null}
      {error ? <p role="alert" className="w-full text-[13px] text-danger">{error}</p> : null}
    </form>
  )

  if (!budget || editing) {
    return (
      <Card>
        <CardHeader title="Aylık bütçe" />
        <div className="space-y-2 px-5 pb-5">
          {!budget ? <p className="text-[13px] text-ink-2">Bir tutar belirlersen, bu hızla ne zaman aşacağını burada ve Genel bakış'ta görürsün. Tutar liste fiyatı üzerinden karşılaştırılır.</p> : null}
          {form}
        </div>
      </Card>
    )
  }

  const m = report.month
  const used = m.cost / budget.monthly
  const projected = m.projected / budget.monthly
  const over = m.cost >= budget.monthly
  return (
    <Card>
      <CardHeader
        title="Aylık bütçe"
        aside={
          <span className="flex gap-3">
            <button type="button" onClick={() => { setValue(String(budget.monthly)); setEditing(true) }} className="text-accent hover:underline">Değiştir</button>
            <button type="button" onClick={() => void save(null)} className="text-ink-3 hover:text-ink">Kaldır</button>
          </span>
        }
      />
      <div className="px-5 pb-5">
        <p className="text-[14px]">
          <span className="font-display text-[22px] font-semibold num">{fmtUsd(m.cost)}</span>
          <span className="text-ink-2"> / {fmtUsd(budget.monthly)}</span>
        </p>
        <div className="relative mt-2 h-2.5 rounded-full bg-line/60" role="img" aria-label={`Bütçenin ${withPossessive(used * 100, '%')} kullanıldı, ay sonu tahmini %${Math.round(projected * 100)}`}>
          <div className={cx('h-full rounded-full', over ? 'bg-danger' : 'bg-[var(--heat-3)]')} style={{ width: `${Math.min(100, used * 100)}%` }} />
          {/* The projection, as a tick where the month would end at today's pace. */}
          <span className="absolute top-[-3px] h-4 w-0.5 rounded-full bg-ink" style={{ left: `calc(${Math.min(100, projected * 100)}% - 1px)` }} aria-hidden />
        </div>
        <p className={cx('mt-2 text-[13px]', over || budget.crossesOn ? 'text-danger' : 'text-ink-2')}>
          {over
            ? `Bütçe ${budget.crossesOn ? fmtDayShort(budget.crossesOn) : 'bu ay'} tarihinde aşıldı.`
            : budget.crossesOn
              ? `Bu hızla ay sonunda yaklaşık ${fmtUsd(m.projected)}; bütçe ${fmtDayShort(budget.crossesOn)} tarihinde aşılır.`
              : `Bu hızla ay sonunda yaklaşık ${fmtUsd(m.projected)}; bütçenin içinde kalıyorsun.`}
        </p>
        <p className="mt-1 text-[12px] text-ink-3">Çizgi, bugünkü hızla ayın nerede biteceğini gösterir.</p>
        {error ? <p role="alert" className="mt-2 text-[13px] text-danger">{error}</p> : null}
      </div>
    </Card>
  )
}

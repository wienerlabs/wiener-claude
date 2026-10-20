import { CircleGauge, Info, PiggyBank } from 'lucide-react'
import { withPossessive } from '../../../shared/tr.ts'
import type { CostReport, LimitHit, Limits } from '../../../shared/types.ts'
import { DailyBars, HBars, ShareBar } from '../components/charts.tsx'
import { Card, CardHeader, ErrorNote, Skeleton, cx } from '../components/ui.tsx'
import { useApi } from '../lib/api.ts'
import { fmtDateTime, fmtDuration, fmtInt, fmtRelative, fmtTime, fmtUsd, modelName } from '../lib/format.ts'

export function Costs() {
  const { data, error } = useApi<CostReport>('/api/costs')
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
  const day = Number(m.to.slice(8, 10))
  const vsLast = m.lastMonthToDate > 0 ? Math.round(((m.cost - m.lastMonthToDate) / m.lastMonthToDate) * 100) : null

  return (
    <div className="mx-auto max-w-[1180px] space-y-6">
      <header className="space-y-2">
        <h1 className="font-display text-[34px] leading-[1.1] font-semibold tracking-[-0.03em] sm:text-[44px]">
          <span className="text-ink-2">Bu ay </span>
          <span className="num">{fmtUsd(m.cost)}</span>
        </h1>
        <p className="max-w-[72ch] text-[15px] text-ink-2">
          Ayın {day}. günü. Bu hızla ay sonunda yaklaşık {fmtUsd(m.projected)}
          {m.lastMonthToDate > 0 ? `; geçen ayın aynı döneminde ${fmtUsd(m.lastMonthToDate)} harcamıştın` : ''}.
          {' '}Tutarlar liste fiyatıyla hesaplanır; abonelikte ödediğin ücret değil, kullanımının API karşılığıdır.
        </p>
      </header>

      <dl className="grid grid-cols-2 overflow-hidden rounded-xl border border-line bg-surface lg:grid-cols-4">
        <Stat label="Bu ay" value={fmtUsd(m.cost)} note={vsLast === null ? 'geçen ay kayıt yok' : `geçen aya göre ${vsLast >= 0 ? '+' : '−'}%${Math.abs(vsLast)}`} />
        <Stat label="Ay sonu tahmini" value={fmtUsd(m.projected)} note={`geçen ay toplam ${fmtUsd(m.lastMonth)}`} className="border-l border-line" />
        <Stat label="Önbellek tasarrufu" value={fmtUsd(data.cacheSavings)} note="önbellek olmasaydı bu kadar fazla tutardı" className="border-t border-line lg:border-t-0 lg:border-l" />
        <Stat
          label="Dökümde görünmeyen"
          value={fmtUsd(m.hidden)}
          note="Claude Code sayacının dökümü aştığı kısım"
          className="border-t border-l border-line lg:border-t-0"
        />
      </dl>

      <Card>
        <CardHeader title="Son 30 gün" aside="günlük tahmini maliyet" />
        <div className="px-5 pt-2 pb-4">
          <DailyBars data={data.daily} />
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Para nereye gidiyor" aside="bu ay, token türüne göre" />
          <div className="px-5 pb-5">
            <ShareBar
              format={fmtUsd}
              parts={[
                { label: 'Önbellekten okuma', value: data.mix.cacheRead, color: 'var(--cat-1)' },
                { label: 'Önbelleğe yazma', value: data.mix.cacheWrite, color: 'var(--cat-2)' },
                { label: 'Çıktı', value: data.mix.output, color: 'var(--cat-3)' },
                { label: 'Girdi', value: data.mix.input, color: 'var(--cat-4)' },
              ]}
            />
            <p className="mt-4 text-[12px] text-ink-3">
              Her istekte konuşmanın tamamı yeniden okunur; uzun oturumlarda maliyetin çoğu bu yüzden önbellekten okumadan gelir.
            </p>
          </div>
        </Card>
        <Card>
          <CardHeader title="Model bazında" aside="bu ay" />
          <div className="px-5 pb-5">
            {data.models.length ? (
              <HBars
                format={fmtUsd}
                items={data.models.map((x) => ({ label: modelName(x.model), value: x.cost, note: `%${Math.round(x.share * 100)}` }))}
              />
            ) : (
              <p className="text-ink-2">Bu ay kayıt yok.</p>
            )}
          </div>
        </Card>
      </div>

      <LimitsCard l={data.limits} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Projeler" aside="bu ay en çok harcayanlar" />
          <div className="px-5 pb-5">
            {data.projects.length ? (
              <HBars format={fmtUsd} items={data.projects.map((p) => ({ label: p.name, value: p.cost }))} />
            ) : (
              <p className="text-ink-2">Bu ay kayıt yok.</p>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Tasarruf fırsatları" />
          <ul className="px-5 pb-4">
            {data.suggestions.length === 0 ? <li className="py-2 text-ink-2">Bu ay belirgin bir tasarruf fırsatı görünmüyor.</li> : null}
            {data.suggestions.map((s) => (
              <li key={s.text} className="flex gap-3 border-t border-line py-3 first:border-t-0">
                <PiggyBank className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
                <span className="flex-1 text-[14px]">{s.text}</span>
                {s.saving ? <span className="shrink-0 font-mono text-[12px] text-good num">~{fmtUsd(s.saving)}</span> : null}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  )
}

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
      <div className="grid gap-6 px-5 pb-5 lg:grid-cols-3">
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

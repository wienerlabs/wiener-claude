import { Download } from 'lucide-react'
import { useRef, useState } from 'react'
import type { YearReport } from '../../../shared/types.ts'
import { withPossessive } from '../../../shared/tr.ts'
import { Card, CardHeader, ErrorNote, Segmented, Skeleton, cx } from '../components/ui.tsx'
import { CARD_FONTS, CARD_H, CARD_W, YearCard } from '../components/YearCard.tsx'
import { useApi } from '../lib/api.ts'
import { fmtCompact, fmtCount, fmtDayLong, fmtDayShort, fmtInt, fmtUsd, modelName, monthsShort, weekdays } from '../lib/format.ts'
import { tx } from '../lib/i18n.ts'
import { downloadSvgAsPng } from '../lib/png.ts'
import { navigate, onLinkClick, useLocation } from '../lib/router.ts'

const times = (n: number) => tx(`${fmtInt(n)} kez`, n === 1 ? 'once' : `${fmtInt(n)} times`)

export function Year() {
  const { query } = useLocation()
  const asked = Number(query.get('yil'))
  const year = Number.isInteger(asked) && asked > 2000 ? asked : new Date().getFullYear()
  const { data, error, stale } = useApi<YearReport>(`/api/year?year=${year}`, { keepPrevious: true })
  const [hideProjects, setHideProjects] = useState(false)
  const [hideCost, setHideCost] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const card = useRef<SVGSVGElement>(null)

  const save = async () => {
    if (!card.current) return
    setSaving(true)
    setSaveError(null)
    try {
      await downloadSvgAsPng(card.current, `claude-code-${year}.png`, { width: CARD_W, height: CARD_H, fonts: CARD_FONTS })
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const years = data?.years.length ? data.years : [year]
  const empty = data && data.totals.messages === 0

  return (
    <div className="mx-auto max-w-[1180px] space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em]">{tx('Yıl özeti', 'Year in review')}</h1>
          <p className="text-[14px] text-ink-2">
            {tx(
              'Bir yılın Claude Code kullanımı tek kartta. Kart tarayıcında oluşturulur, hiçbir yere gönderilmez.',
              "A year of Claude Code on a single card. It's created in your browser and never sent anywhere.",
            )}
          </p>
        </div>
        {years.length > 1 ? (
          <Segmented
            label={tx('Yıl', 'Year')}
            value={String(year)}
            onChange={(v) => navigate(Number(v) === new Date().getFullYear() ? '/yil-ozeti' : `/yil-ozeti?yil=${v}`, { replace: true })}
            options={years.map((y) => ({ value: String(y), label: String(y) }))}
          />
        ) : null}
      </header>

      {error ? <ErrorNote message={error} /> : null}
      {!data && !error ? <Skeleton className="aspect-[3/2] w-full" /> : null}
      {empty ? <p className="text-ink-2">{tx(`${year} için kayıtlı etkinlik yok.`, `No activity recorded in ${year}.`)}</p> : null}

      {data && !empty ? (
        <div className={cx('space-y-6 transition-opacity', stale && 'opacity-60')} aria-busy={stale}>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <Toggle checked={hideProjects} onChange={setHideProjects} label={tx('Proje adlarını gizle', 'Hide project names')} />
            <Toggle checked={hideCost} onChange={setHideCost} label={tx('Maliyeti gizle', 'Hide cost')} />
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="ml-auto inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60 dark:text-bg"
            >
              <Download className="size-4" aria-hidden />
              {saving ? tx('Hazırlanıyor…', 'Preparing…') : tx('PNG olarak indir', 'Download PNG')}
            </button>
          </div>
          {saveError ? <ErrorNote message={tx(`Resim oluşturulamadı: ${saveError}`, `Couldn't create the image: ${saveError}`)} /> : null}

          <div className="overflow-hidden rounded-xl border border-line">
            <YearCard ref={card} data={data} options={{ hideProjects, hideCost }} />
          </div>
          <p className="text-[12px] text-ink-3">
            {tx(
              'Kart şu anki temayla indirilir; koyu kart için önce koyu temaya geç.',
              'The card downloads in the current theme. For a dark card, switch to the dark theme first.',
            )}
          </p>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
            <Card>
              <CardHeader title={tx('Yılın sayıları', 'The year in numbers')} aside={data.partial ? tx('bugüne kadar', 'so far') : undefined} />
              <dl className="px-5 pb-4 text-[13px]">
                <Row label={tx('Mesaj', 'Messages')} value={fmtInt(data.totals.messages)} />
                <Row label={tx('Yazdığın prompt', 'Prompts you wrote')} value={fmtInt(data.totals.prompts)} />
                <Row label={tx('Oturum', 'Sessions')} value={fmtInt(data.totals.sessions)} />
                <Row label={tx('Aktif gün', 'Active days')} value={fmtInt(data.activeDays)} />
                <Row label={tx('Toplam token', 'Total tokens')} value={fmtCompact(data.totals.tokens)} title={fmtInt(data.totals.tokens)} />
                <Row
                  label={tx("Claude'un yazdığı", 'Written by Claude')}
                  value={tx(`${fmtCompact(data.totals.outputTokens)} token`, `${fmtCompact(data.totals.outputTokens)} tokens`)}
                  title={fmtInt(data.totals.outputTokens)}
                />
                <Row label={tx('Tahmini maliyet', 'Estimated cost')} value={fmtUsd(data.totals.cost)} />
                <Row
                  label={tx('Değişen satır', 'Lines changed')}
                  value={
                    <>
                      <span className="text-good">+{fmtInt(data.totals.linesAdded)}</span> <span className="text-danger">−{fmtInt(data.totals.linesRemoved)}</span>
                    </>
                  }
                />
                <Row label={tx('Düzenlenen dosya', 'Files edited')} value={fmtInt(data.totals.files)} />
                <Row label={tx('Açılan PR', 'PRs opened')} value={fmtInt(data.totals.prs)} />
                <Row label={tx('Araç çağrısı', 'Tool calls')} value={fmtInt(data.totals.toolCalls)} />
              </dl>
            </Card>

            <Card>
              <CardHeader title={tx('Alışkanlıklar', 'Habits')} />
              <dl className="px-5 pb-4 text-[13px]">
                <Row label={tx('İlk gün', 'First day')} value={data.firstDay ? fmtDayLong(data.firstDay) : '—'} />
                <Row
                  label={tx('En uzun seri', 'Longest streak')}
                  value={data.longestStreak ? tx(`${data.longestStreak.days} gün`, `${data.longestStreak.days} ${data.longestStreak.days === 1 ? 'day' : 'days'}`) : '—'}
                  title={data.longestStreak ? `${fmtDayLong(data.longestStreak.from)} – ${fmtDayLong(data.longestStreak.to)}` : undefined}
                />
                <Row
                  label={tx('En yoğun gün', 'Busiest day')}
                  value={
                    data.busiestDay
                      ? tx(`${fmtDayLong(data.busiestDay.day).split(',')[0]}`, `${fmtDayShort(data.busiestDay.day)}, ${data.busiestDay.day.slice(0, 4)}`)
                      : '—'
                  }
                  title={data.busiestDay ? fmtCount(data.busiestDay.messages, 'mesaj', 'message') : undefined}
                />
                <Row label={tx('En sevdiğin gün', 'Favorite day')} value={data.peakWeekday !== null ? (weekdays()[data.peakWeekday] ?? '—') : '—'} />
                <Row
                  label={tx('En verimli saat', 'Peak hour')}
                  value={
                    data.peakHour !== null
                      ? tx(
                          `${String(data.peakHour).padStart(2, '0')}.00–${String((data.peakHour + 1) % 24).padStart(2, '0')}.00`,
                          `${String(data.peakHour).padStart(2, '0')}:00–${String((data.peakHour + 1) % 24).padStart(2, '0')}:00`,
                        )
                      : '—'
                  }
                />
                <Row
                  label="Model"
                  value={
                    data.model
                      ? tx(
                          `${modelName(data.model.name)}, yanıtların ${withPossessive(Math.round(data.model.share * 100), '%')}`,
                          `${modelName(data.model.name)}, ${Math.round(data.model.share * 100)}% of responses`,
                        )
                      : '—'
                  }
                />
                <Row label="Skill" value={data.skill ? `${data.skill.name} · ${times(data.skill.calls)}` : '—'} mono />
                <Row label={tx('Slash komutu', 'Slash command')} value={data.command ? `${data.command.name} · ${times(data.command.uses)}` : '—'} mono />
                <Row label="Subagent" value={data.agent ? `${data.agent.name} · ${times(data.agent.calls)}` : '—'} mono />
              </dl>
              {data.longestSession ? (
                <p className="border-t border-line px-5 py-3 text-[13px]">
                  <span className="block text-[12px] text-ink-3">
                    {tx('En uzun oturum', 'Longest session')}, {fmtCount(data.longestSession.messages, 'mesaj', 'message')}
                  </span>
                  <a
                    href={`/oturumlar/${data.longestSession.id}`}
                    onClick={(e) => onLinkClick(e, `/oturumlar/${data.longestSession?.id}`)}
                    className="line-clamp-2 text-accent underline underline-offset-2"
                  >
                    {data.longestSession.title}
                  </a>
                </p>
              ) : null}
            </Card>

            <Card>
              <CardHeader title={tx('Aylara göre mesaj', 'Messages by month')} />
              <MonthBars months={data.months} year={data.year} to={data.to} />
            </Card>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-ink-2 select-none">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-[var(--accent)]" />
      {label}
    </label>
  )
}

function Row({ label, value, title, mono = false }: { label: string; value: React.ReactNode; title?: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-3 border-t border-line py-1.5 first:border-t-0">
      <dt className="shrink-0 text-ink-2">{label}</dt>
      <dd className={cx('min-w-0 flex-1 text-right break-words num', mono && 'font-mono text-[12px]')} title={title}>
        {value}
      </dd>
    </div>
  )
}

function MonthBars({ months, year, to }: { months: number[]; year: number; to: string }) {
  const max = Math.max(...months, 1)
  const lastMonth = to.startsWith(String(year)) ? Number(to.slice(5, 7)) - 1 : 11
  return (
    <ul className="space-y-1.5 px-5 pb-5">
      {months.map((v, i) => (
        <li key={i} className={cx('grid grid-cols-[2.25rem_minmax(0,1fr)_4.5rem] items-center gap-3 text-[12px]', i > lastMonth && 'opacity-40')}>
          <span className="text-ink-2">{monthsShort()[i]}</span>
          <span className="h-2 overflow-hidden rounded-full bg-line/50">
            <span className="block h-full rounded-full bg-[var(--heat-3)]" style={{ width: `${(v / max) * 100}%` }} />
          </span>
          <span className="text-right font-mono num">{v ? fmtInt(v) : '—'}</span>
        </li>
      ))}
    </ul>
  )
}

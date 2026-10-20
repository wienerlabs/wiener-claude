import { Download } from 'lucide-react'
import { useRef, useState } from 'react'
import type { YearReport } from '../../../shared/types.ts'
import { withPossessive } from '../../../shared/tr.ts'
import { Card, CardHeader, ErrorNote, Segmented, Skeleton, cx } from '../components/ui.tsx'
import { CARD_FONTS, CARD_H, CARD_W, YearCard } from '../components/YearCard.tsx'
import { useApi } from '../lib/api.ts'
import { MONTHS_SHORT, WEEKDAYS, fmtCompact, fmtDayLong, fmtInt, fmtUsd, modelName } from '../lib/format.ts'
import { downloadSvgAsPng } from '../lib/png.ts'
import { navigate, onLinkClick, useLocation } from '../lib/router.ts'

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
          <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em]">Yıl özeti</h1>
          <p className="text-[14px] text-ink-2">Bir yılın Claude Code kullanımı tek kartta. Kart tarayıcında oluşturulur, hiçbir yere gönderilmez.</p>
        </div>
        {years.length > 1 ? (
          <Segmented
            label="Yıl"
            value={String(year)}
            onChange={(v) => navigate(Number(v) === new Date().getFullYear() ? '/yil-ozeti' : `/yil-ozeti?yil=${v}`, { replace: true })}
            options={years.map((y) => ({ value: String(y), label: String(y) }))}
          />
        ) : null}
      </header>

      {error ? <ErrorNote message={error} /> : null}
      {!data && !error ? <Skeleton className="aspect-[3/2] w-full" /> : null}
      {empty ? <p className="text-ink-2">{year} için kayıtlı etkinlik yok.</p> : null}

      {data && !empty ? (
        <div className={cx('space-y-6 transition-opacity', stale && 'opacity-60')} aria-busy={stale}>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <Toggle checked={hideProjects} onChange={setHideProjects} label="Proje adlarını gizle" />
            <Toggle checked={hideCost} onChange={setHideCost} label="Maliyeti gizle" />
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="ml-auto inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60 dark:text-bg"
            >
              <Download className="size-4" aria-hidden />
              {saving ? 'Hazırlanıyor…' : 'PNG olarak indir'}
            </button>
          </div>
          {saveError ? <ErrorNote message={`Resim oluşturulamadı: ${saveError}`} /> : null}

          <div className="overflow-hidden rounded-xl border border-line">
            <YearCard ref={card} data={data} options={{ hideProjects, hideCost }} />
          </div>
          <p className="text-[12px] text-ink-3">Kart şu anki temayla indirilir; koyu kart için önce koyu temaya geç.</p>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
            <Card>
              <CardHeader title="Yılın sayıları" aside={data.partial ? 'bugüne kadar' : undefined} />
              <dl className="px-5 pb-4 text-[13px]">
                <Row label="Mesaj" value={fmtInt(data.totals.messages)} />
                <Row label="Yazdığın prompt" value={fmtInt(data.totals.prompts)} />
                <Row label="Oturum" value={fmtInt(data.totals.sessions)} />
                <Row label="Aktif gün" value={fmtInt(data.activeDays)} />
                <Row label="Toplam token" value={fmtCompact(data.totals.tokens)} title={fmtInt(data.totals.tokens)} />
                <Row label="Claude'un yazdığı" value={`${fmtCompact(data.totals.outputTokens)} token`} title={fmtInt(data.totals.outputTokens)} />
                <Row label="Tahmini maliyet" value={fmtUsd(data.totals.cost)} />
                <Row
                  label="Değişen satır"
                  value={
                    <>
                      <span className="text-good">+{fmtInt(data.totals.linesAdded)}</span> <span className="text-danger">−{fmtInt(data.totals.linesRemoved)}</span>
                    </>
                  }
                />
                <Row label="Düzenlenen dosya" value={fmtInt(data.totals.files)} />
                <Row label="Açılan PR" value={fmtInt(data.totals.prs)} />
                <Row label="Araç çağrısı" value={fmtInt(data.totals.toolCalls)} />
              </dl>
            </Card>

            <Card>
              <CardHeader title="Alışkanlıklar" />
              <dl className="px-5 pb-4 text-[13px]">
                <Row label="İlk gün" value={data.firstDay ? fmtDayLong(data.firstDay) : '—'} />
                <Row
                  label="En uzun seri"
                  value={data.longestStreak ? `${data.longestStreak.days} gün` : '—'}
                  title={data.longestStreak ? `${fmtDayLong(data.longestStreak.from)} – ${fmtDayLong(data.longestStreak.to)}` : undefined}
                />
                <Row
                  label="En yoğun gün"
                  value={data.busiestDay ? `${fmtDayLong(data.busiestDay.day).split(',')[0]}` : '—'}
                  title={data.busiestDay ? `${fmtInt(data.busiestDay.messages)} mesaj` : undefined}
                />
                <Row label="En sevdiğin gün" value={data.peakWeekday !== null ? (WEEKDAYS[data.peakWeekday] ?? '—') : '—'} />
                <Row label="En verimli saat" value={data.peakHour !== null ? `${String(data.peakHour).padStart(2, '0')}.00–${String((data.peakHour + 1) % 24).padStart(2, '0')}.00` : '—'} />
                <Row label="Model" value={data.model ? `${modelName(data.model.name)}, yanıtların ${withPossessive(Math.round(data.model.share * 100), '%')}` : '—'} />
                <Row label="Skill" value={data.skill ? `${data.skill.name} · ${fmtInt(data.skill.calls)} kez` : '—'} mono />
                <Row label="Slash komutu" value={data.command ? `${data.command.name} · ${fmtInt(data.command.uses)} kez` : '—'} mono />
                <Row label="Subagent" value={data.agent ? `${data.agent.name} · ${fmtInt(data.agent.calls)} kez` : '—'} mono />
              </dl>
              {data.longestSession ? (
                <p className="border-t border-line px-5 py-3 text-[13px]">
                  <span className="block text-[12px] text-ink-3">En uzun oturum, {fmtInt(data.longestSession.messages)} mesaj</span>
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
              <CardHeader title="Aylara göre mesaj" />
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
          <span className="text-ink-2">{MONTHS_SHORT[i]}</span>
          <span className="h-2 overflow-hidden rounded-full bg-line/50">
            <span className="block h-full rounded-full bg-[var(--heat-3)]" style={{ width: `${(v / max) * 100}%` }} />
          </span>
          <span className="text-right font-mono num">{v ? fmtInt(v) : '—'}</span>
        </li>
      ))}
    </ul>
  )
}

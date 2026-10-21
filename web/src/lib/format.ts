import { compactNumber, dayMonth, formatInt, formatUsd, monthNames, monthNamesShort, weekdayNames, weekdayNamesShort } from '../../../shared/i18n.ts'
import type { Metric } from '../../../shared/types.ts'
import { getLang, tx } from './i18n.ts'

export const fmtInt = (n: number) => formatInt(n, getLang())
/** "12,3 bin", "72,8 milyon" in Turkish; "12.3K", "72.8M" in English. */
export const fmtCompact = (n: number) => compactNumber(n, getLang())
export const fmtUsd = (n: number) => formatUsd(n, getLang())

/** "3 oturum" in Turkish; "1 session", "3 sessions" in English. */
export function fmtCount(n: number, tr: string, enOne: string, enMany = `${enOne}s`): string {
  return tx(`${fmtInt(n)} ${tr}`, `${fmtInt(n)} ${Math.round(n) === 1 ? enOne : enMany}`)
}

export function metricLabel(metric: Metric): string {
  switch (metric) {
    case 'messages':
      return tx('Mesaj', 'Messages')
    case 'tokens':
      return tx('Token', 'Tokens')
    case 'cost':
      return tx('Maliyet', 'Cost')
    case 'sessions':
      return tx('Oturum', 'Sessions')
    case 'errors':
      return tx('Hata', 'Errors')
  }
}

/** "1.234 mesaj", "$12,40", "3,4 milyon token" */
export function fmtMetric(metric: Metric, value: number): string {
  switch (metric) {
    case 'cost':
      return fmtUsd(value)
    case 'tokens':
      return tx(`${fmtCompact(value)} token`, `${fmtCompact(value)} tokens`)
    case 'messages':
      return fmtCount(value, 'mesaj', 'message')
    case 'sessions':
      return fmtCount(value, 'oturum', 'session')
    case 'errors':
      return fmtCount(value, 'hata', 'error')
  }
}

/** Short value for legends and tight spaces. */
export function fmtMetricShort(metric: Metric, value: number): string {
  if (metric === 'cost') return formatUsd(value, getLang(), 100)
  if (metric === 'tokens') return fmtCompact(value)
  return fmtInt(value)
}

export const monthsShort = () => monthNamesShort(getLang())
/** Monday first. */
export const weekdays = () => weekdayNames(getLang())
export const weekdaysShort = () => weekdayNamesShort(getLang())

export function parseDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d)
}

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** "12 Ekim 2026, Pazartesi"; "Monday, October 12, 2026" */
export function fmtDayLong(day: string): string {
  const d = parseDay(day)
  const lang = getLang()
  const month = monthNames(lang)[d.getMonth()]
  const weekday = weekdayNames(lang)[(d.getDay() + 6) % 7]
  return tx(`${d.getDate()} ${month} ${d.getFullYear()}, ${weekday}`, `${weekday}, ${month} ${d.getDate()}, ${d.getFullYear()}`)
}

/** "12 Ekim"; "October 12" */
export function fmtDayShort(day: string): string {
  const d = parseDay(day)
  return dayMonth(d.getDate(), d.getMonth(), getLang())
}

export function fmtTime(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** "26 Ağu 10:43"; "Aug 26, 10:43". The year shows when it is not this one. */
export function fmtDateTime(ts: number): string {
  const d = new Date(ts)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  const month = monthsShort()[d.getMonth()]
  return tx(
    `${d.getDate()} ${month}${sameYear ? '' : ` ${d.getFullYear()}`} ${fmtTime(ts)}`,
    `${month} ${d.getDate()}${sameYear ? '' : `, ${d.getFullYear()}`}, ${fmtTime(ts)}`,
  )
}

/** "1 sa 12 dk", "24 dk", "40 sn"; "1 hr 12 min", "24 min", "40 sec" */
export function fmtDuration(ms: number): string {
  const min = Math.round(ms / 60_000)
  if (ms < 60_000) return tx(`${Math.max(0, Math.round(ms / 1000))} sn`, `${Math.max(0, Math.round(ms / 1000))} sec`)
  if (min < 60) return tx(`${min} dk`, `${min} min`)
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? tx(`${h} sa ${m} dk`, `${h} hr ${m} min`) : tx(`${h} sa`, `${h} hr`)
}

/** "az önce", "5 dk önce", "dün 14:05", "3 gün önce", or a date. */
export function fmtRelative(ts: number, now = Date.now()): string {
  const diff = now - ts
  if (diff < 60_000) return tx('az önce', 'just now')
  if (diff < 3_600_000) return tx(`${Math.round(diff / 60_000)} dk önce`, `${Math.round(diff / 60_000)} min ago`)
  const d = new Date(ts)
  const today = new Date(now)
  const days = Math.round((parseDay(dayKey(today)).getTime() - parseDay(dayKey(d)).getTime()) / 86_400_000)
  if (days === 0) return tx(`bugün ${fmtTime(ts)}`, `today ${fmtTime(ts)}`)
  if (days === 1) return tx(`dün ${fmtTime(ts)}`, `yesterday ${fmtTime(ts)}`)
  if (days < 7) return tx(`${days} gün önce`, `${days} days ago`)
  return fmtDateTime(ts)
}

export function modelName(model: string): string {
  const m = model.replace(/^claude-/, '').replace(/-\d{8}$/, '')
  const [family, ...ver] = m.split('-')
  if (!family) return model
  return `${family[0]?.toUpperCase()}${family.slice(1)} ${ver.join('.')}`.trim()
}

/** claude.ai connectors reach Claude Code under an id instead of a name. */
export function mcpServerLabel(name: string): string {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(name) ? `claude.ai connector ${name.slice(0, 8)}` : name
}

/** "1 Ağu"; "Aug 1": tick labels. */
export function fmtDayMonthShort(d: Date): string {
  const month = monthsShort()[d.getMonth()]
  return tx(`${d.getDate()} ${month}`, `${month} ${d.getDate()}`)
}

/** Language names are proper nouns, except the two the server files things under. */
export function languageLabel(name: string): string {
  if (name === 'Text') return tx('Metin', 'Text')
  if (name === 'Other') return tx('Diğer', 'Other')
  return name
}

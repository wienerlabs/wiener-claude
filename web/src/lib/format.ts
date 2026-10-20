import { compactNumber } from '../../../shared/tr.ts'
import type { Metric } from '../../../shared/types.ts'

const int = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 })
const usd = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'USD', maximumFractionDigits: 2, minimumFractionDigits: 2 })
const usdRound = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

export const fmtInt = (n: number) => int.format(Math.round(n))
/** "12,3 bin", "72,8 milyon", "25,9 milyar" */
export const fmtCompact = compactNumber
export const fmtUsd = (n: number) => (Math.abs(n) >= 1000 ? usdRound.format(n) : usd.format(n))

export const METRIC_LABEL: Record<Metric, string> = {
  messages: 'Mesaj',
  tokens: 'Token',
  cost: 'Maliyet',
  sessions: 'Oturum',
  errors: 'Hata',
}

/** "1.234 mesaj", "$12,40", "3,4 Mn token" */
export function fmtMetric(metric: Metric, value: number): string {
  switch (metric) {
    case 'cost':
      return fmtUsd(value)
    case 'tokens':
      return `${fmtCompact(value)} token`
    case 'messages':
      return `${fmtInt(value)} mesaj`
    case 'sessions':
      return `${fmtInt(value)} oturum`
    case 'errors':
      return `${fmtInt(value)} hata`
  }
}

/** Short value for legends and tight spaces. */
export function fmtMetricShort(metric: Metric, value: number): string {
  if (metric === 'cost') return value >= 100 ? usdRound.format(value) : usd.format(value)
  if (metric === 'tokens') return fmtCompact(value)
  return fmtInt(value)
}

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']
export const MONTHS_SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']
export const WEEKDAYS = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar']
export const WEEKDAYS_SHORT = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']

export function parseDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d)
}

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** "12 Ekim 2026, Pazartesi" */
export function fmtDayLong(day: string): string {
  const d = parseDay(day)
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${WEEKDAYS[(d.getDay() + 6) % 7]}`
}

/** "12 Ekim" */
export function fmtDayShort(day: string): string {
  const d = parseDay(day)
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`
}

export function fmtTime(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function fmtDateTime(ts: number): string {
  const d = new Date(ts)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}${sameYear ? '' : ` ${d.getFullYear()}`} ${fmtTime(ts)}`
}

/** "1 sa 12 dk", "24 dk", "40 sn" */
export function fmtDuration(ms: number): string {
  const min = Math.round(ms / 60_000)
  if (ms < 60_000) return `${Math.max(0, Math.round(ms / 1000))} sn`
  if (min < 60) return `${min} dk`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} sa ${m} dk` : `${h} sa`
}

/** "az önce", "5 dk önce", "dün", "3 gün önce", or a date. */
export function fmtRelative(ts: number, now = Date.now()): string {
  const diff = now - ts
  if (diff < 60_000) return 'az önce'
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} dk önce`
  const d = new Date(ts)
  const today = new Date(now)
  const days = Math.round((parseDay(dayKey(today)).getTime() - parseDay(dayKey(d)).getTime()) / 86_400_000)
  if (days === 0) return `bugün ${fmtTime(ts)}`
  if (days === 1) return `dün ${fmtTime(ts)}`
  if (days < 7) return `${days} gün önce`
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

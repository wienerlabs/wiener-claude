// The interface speaks Turkish and English. Text is written in both languages side by side where it
// is used, and `pick` chooses one; numbers, money and dates follow the language's own conventions.

export type Lang = 'tr' | 'en'

export const LANGS: Lang[] = ['tr', 'en']

export const isLang = (v: unknown): v is Lang => v === 'tr' || v === 'en'

export const LOCALE: Record<Lang, string> = { tr: 'tr-TR', en: 'en-US' }

/** The Turkish or the English version, for `lang`. */
export const pick = <T>(lang: Lang, tr: T, en: T): T => (lang === 'en' ? en : tr)

const formats = new Map<string, Intl.NumberFormat>()
function numberFormat(lang: Lang, opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${lang}${JSON.stringify(opts)}`
  let f = formats.get(key)
  if (!f) {
    f = new Intl.NumberFormat(LOCALE[lang], opts)
    formats.set(key, f)
  }
  return f
}

/** "1.347" in Turkish, "1,347" in English. */
export const formatInt = (n: number, lang: Lang) => numberFormat(lang, { maximumFractionDigits: 0 }).format(Math.round(n))

/** "$6,92" in Turkish, "$6.92" in English; whole dollars from `wholeFrom` up. */
export function formatUsd(n: number, lang: Lang, wholeFrom = 1000): string {
  return Math.abs(n) >= wholeFrom
    ? numberFormat(lang, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
    : numberFormat(lang, { style: 'currency', currency: 'USD', maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(n)
}

const COMPACT: Record<Lang, readonly (readonly [number, string])[]> = {
  tr: [[1e12, ' trilyon'], [1e9, ' milyar'], [1e6, ' milyon'], [1e3, ' bin']],
  en: [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']],
}

/**
 * Large counts in words: "12,3 bin", "72,8 milyon" in Turkish; "12.3K", "72.8M" in English. Intl's
 * Turkish compact form writes thousands as "B", which reads as billions to most developers.
 */
export function compactNumber(n: number, lang: Lang): string {
  const abs = Math.abs(n)
  if (abs < 1e3) return formatInt(n, lang)
  for (const [size, word] of COMPACT[lang]) {
    if (abs >= size) return `${numberFormat(lang, { maximumFractionDigits: 1 }).format(n / size)}${word}`
  }
  return formatInt(n, lang)
}

const MONTHS: Record<Lang, string[]> = {
  tr: ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
}
const MONTHS_SHORT: Record<Lang, string[]> = {
  tr: ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
}
/** Monday first, as the heatmaps are drawn. */
const WEEKDAYS: Record<Lang, string[]> = {
  tr: ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'],
  en: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
}
const WEEKDAYS_SHORT: Record<Lang, string[]> = {
  tr: ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'],
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
}

export const monthNames = (lang: Lang) => MONTHS[lang]
export const monthNamesShort = (lang: Lang) => MONTHS_SHORT[lang]
export const weekdayNames = (lang: Lang) => WEEKDAYS[lang]
export const weekdayNamesShort = (lang: Lang) => WEEKDAYS_SHORT[lang]

/** "14 Eylül" in Turkish, "September 14" in English; month is 0-based. */
export const dayMonth = (day: number, month: number, lang: Lang) => pick(lang, `${day} ${MONTHS.tr[month]}`, `${MONTHS.en[month]} ${day}`)

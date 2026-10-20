// Turkish number suffixes follow the last spoken word of the number: 41'i (bir), 40'ı (kırk), 30'u (otuz).

const UNIT_POSSESSIVE = ["'ı", "'i", "'si", "'ü", "'ü", "'i", "'sı", "'si", "'i", "'u"]
const TEN_POSSESSIVE = ['', "'u", "'si", "'u", "'ı", "'si", "'ı", "'i", "'i", "'ı"]

/** Third-person possessive suffix for a whole number: 22 -> "'si" (yirmi iki-si). */
export function possessive(value: number): string {
  const v = Math.abs(Math.round(value))
  if (v === 0) return UNIT_POSSESSIVE[0] as string
  if (v % 10 !== 0) return UNIT_POSSESSIVE[v % 10] as string
  if (v % 100 !== 0) return TEN_POSSESSIVE[(v / 10) % 10] as string
  if (v % 1000 !== 0) return "'ü"
  if (v % 1_000_000 !== 0) return "'i"
  return "'u"
}

/** "22'si", "%41'i" */
export function withPossessive(value: number, prefix = ''): string {
  return `${prefix}${Math.round(value)}${possessive(value)}`
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Local calendar day, hour, and weekday (0 = Monday) of a timestamp. */
export function localParts(ts: number): { day: string; hour: number; dow: number } {
  const d = new Date(ts)
  return { day: dayKey(d), hour: d.getHours(), dow: (d.getDay() + 6) % 7 }
}

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  return dayKey(new Date(y, m - 1, d + n))
}

export function today(): string {
  return dayKey(new Date())
}

/** Monday of the week containing `day`. */
export function weekStart(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  const date = new Date(y, m - 1, d)
  return addDays(day, -((date.getDay() + 6) % 7))
}

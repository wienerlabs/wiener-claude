import type { ReactNode } from 'react'
import { tx } from '../lib/i18n.ts'

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

export function Segmented<T extends string>({
  label, options, value, onChange,
}: {
  label: string
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-md px-2.5 py-1 text-[13px] transition-colors',
            value === o.value ? 'bg-accent-soft font-medium text-accent' : 'text-ink-2 hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx('rounded-xl border border-line bg-surface', className)}>{children}</section>
}

export function CardHeader({ title, aside }: { title: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-5 pt-4 pb-2">
      <h2 className="text-[13px] font-medium text-ink">{title}</h2>
      {aside ? <div className="text-[12px] text-ink-3">{aside}</div> : null}
    </div>
  )
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-danger">
      {message}
    </p>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-md bg-line/60', className)} aria-hidden />
}

/** A small "+12%" / "−8%" against a previous value; nothing when there is no basis to compare. */
export function Delta({ now, before, invert = false }: { now: number; before: number; invert?: boolean }) {
  if (before <= 0) return null
  const pct = Math.round(((now - before) / before) * 100)
  if (pct === 0) return <span className="text-ink-3">{tx('aynı', 'no change')}</span>
  const up = pct > 0
  const good = invert ? !up : up
  return (
    <span className={cx('num', good ? 'text-good' : 'text-ink-2')}>
      {up ? '+' : '−'}{tx(`%${Math.abs(pct)}`, `${Math.abs(pct)}%`)}
    </span>
  )
}

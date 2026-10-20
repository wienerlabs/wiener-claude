import { ArrowUpRight, Lightbulb } from 'lucide-react'
import type { RangeKey, Tip } from '../../../shared/types.ts'
import { fmtUsd } from '../lib/format.ts'
import { tx } from '../lib/i18n.ts'
import { rangeHref } from '../lib/range.tsx'
import { onLinkClick } from '../lib/router.ts'

/** "en fazla $1.985", "yaklaşık $490"; "up to $1,985", "about $490" */
export function savingText(tip: Tip): string | null {
  if (tip.saving === null || tip.saving < 0.01) return null
  const amount = fmtUsd(tip.saving)
  return tip.savingKind === 'upTo' ? tx(`en fazla ${amount}`, `up to ${amount}`) : tx(`yaklaşık ${amount}`, `about ${amount}`)
}

/** A short list of tips, each opening the İpuçları page at its card. */
export function TipLinks({ tips, range, empty }: { tips: Tip[]; range: RangeKey; empty: string }) {
  if (tips.length === 0) return <p className="px-5 pb-5 text-ink-2">{empty}</p>
  return (
    <ul className="px-5 pb-4">
      {tips.map((t) => {
        const href = `${rangeHref('/ipuclari', range)}#${t.kind}`
        const saving = savingText(t)
        return (
          <li key={t.kind} className="border-t border-line first:border-t-0">
            <a href={href} onClick={(e) => onLinkClick(e, href)} className="group flex gap-3 py-2.5">
              <Lightbulb className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[14px] font-medium group-hover:underline group-hover:underline-offset-2">{t.title}</span>
                  {saving ? <span className="text-[12px] text-good num">{saving}</span> : null}
                </span>
                <span className="line-clamp-2 block text-[13px] text-ink-2">{t.finding}</span>
              </span>
              <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-ink-3 group-hover:text-ink" aria-hidden />
            </a>
          </li>
        )
      })}
    </ul>
  )
}

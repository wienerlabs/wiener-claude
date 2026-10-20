import { ArrowUpRight, Check, Copy } from 'lucide-react'
import { useState } from 'react'

const COMMAND = 'npx wiener-tools-claude'

/** Shown on the public demo: what this is, and how to see your own data instead. */
export function DemoBanner() {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(COMMAND)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard blocked; the command is on screen to select by hand.
    }
  }
  return (
    <div className="mx-auto mb-6 flex max-w-[1180px] flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-[13px]">
      <p className="min-w-0 flex-1 basis-64">
        <span className="font-medium text-ink">Bu bir demo.</span> <span className="text-ink-2">Veriler uydurma. Kendi Claude Code kullanımını görmek için terminalde çalıştır; panel bilgisayarında açılır, hiçbir veri dışarı gitmez.</span>
      </p>
      <button
        type="button"
        onClick={copy}
        className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 font-mono text-[12px] text-ink hover:border-line-strong"
        aria-label={`${COMMAND} komutunu kopyala`}
      >
        {COMMAND}
        {copied ? <Check className="size-3.5 text-good" aria-hidden /> : <Copy className="size-3.5 text-ink-3" aria-hidden />}
      </button>
      <a href="https://github.com/wienerlabs/wiener-claude" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline hover:underline-offset-2">
        GitHub <ArrowUpRight className="size-3.5" aria-hidden />
      </a>
    </div>
  )
}

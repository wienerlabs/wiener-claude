import { Component, type ReactNode } from 'react'
import { tx } from '../lib/i18n.ts'

interface State {
  error: Error | null
}

/**
 * Keeps one broken screen from blanking the whole app. The usual cause is a panel that was rebuilt
 * while an older server kept running, so the message says how to restart it.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" className="mx-auto max-w-[640px] space-y-3 rounded-xl border border-danger/30 bg-danger-soft px-6 py-5">
        <p className="font-medium text-danger">{tx('Bu ekran gösterilemedi', "This screen couldn't be shown")}</p>
        <p className="text-[14px] text-ink-2">
          {tx(
            'Panel yakın zamanda güncellendiyse sunucu eski sürümle çalışıyor olabilir. Terminalde Ctrl+C ile kapatıp yeniden başlat, sonra sayfayı yenile.',
            'If the dashboard was updated recently, the server may still be running the old version. Stop it with Ctrl+C in your terminal, start it again, then reload the page.',
          )}
        </p>
        <p className="font-mono text-[12px] text-ink-3">{this.state.error.message}</p>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-[13px] hover:bg-raised"
        >
          {tx('Yeniden dene', 'Try again')}
        </button>
      </div>
    )
  }
}

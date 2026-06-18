import { RotateCw, WifiOff } from 'lucide-react'

/**
 * A thin status strip shown ABOVE a widget's content when it already has data:
 * a "couldn't refresh" notice (stale-while-error) or a subtle "refreshing" hint.
 * Renders nothing when data is fresh and idle. Part of the SDK so any widget
 * (built-in or external) can adopt the same non-destructive refresh UX.
 */
export function WidgetStatus({
  error,
  loading,
  onRetry
}: {
  error?: string
  loading?: boolean
  onRetry?: () => void
}): JSX.Element | null {
  if (error) {
    return (
      <div className="widget-status widget-status--error">
        <WifiOff size={11} strokeWidth={2} />
        <span>Couldn’t refresh — showing last update</span>
        {onRetry && (
          <button className="widget-status-retry" onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    )
  }
  if (loading) {
    return (
      <div className="widget-status">
        <RotateCw size={11} strokeWidth={2} className="widget-status-spin" />
        <span>Refreshing…</span>
      </div>
    )
  }
  return null
}

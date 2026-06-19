import { useEffect, useRef, useState } from 'react'

/** Minimal handle onto Electron's <webview> element (avoids pulling electron types). */
type WebviewEl = HTMLElement & { reload: () => void; src: string }

interface Props {
  src: string
  /** Session partition — isolates cookies/storage per widget instance (multi-account safe). */
  partition?: string
  /** Increment to force a reload (wired to the widget's refresh button). */
  refreshToken?: number
}

/**
 * Renders an Electron <webview>. Unlike an <iframe>, a <webview> is a separate
 * web contents, so it bypasses X-Frame-Options / frame-ancestors — which is what
 * lets us embed Google Calendar, Jira, etc. interactively.
 */
export function WebView({ src, partition, refreshToken = 0 }: Props): JSX.Element {
  const ref = useRef<WebviewEl | null>(null)
  const [loading, setLoading] = useState(false)

  // Set string attributes the custom element expects (React would warn on a
  // boolean `allowpopups`, and the value must be a string for <webview>).
  useEffect(() => {
    ref.current?.setAttribute('allowpopups', 'true')
  }, [])

  // Drive a top loading bar off the webview's load lifecycle.
  useEffect(() => {
    const wv = ref.current
    if (!wv) return
    const start = (): void => setLoading(true)
    const stop = (): void => setLoading(false)
    wv.addEventListener('did-start-loading', start)
    wv.addEventListener('did-stop-loading', stop)
    return () => {
      wv.removeEventListener('did-start-loading', start)
      wv.removeEventListener('did-stop-loading', stop)
    }
  }, [])

  useEffect(() => {
    if (refreshToken > 0) ref.current?.reload()
  }, [refreshToken])

  if (!src) {
    return (
      <div className="widget-placeholder">
        Open ⚙ and set a URL to load this widget.
      </div>
    )
  }

  return (
    <>
      {loading && <div className="webview-progress" aria-hidden="true" />}
      <webview
        ref={ref as unknown as React.Ref<HTMLWebViewElement>}
        src={src}
        partition={partition}
        className="widget-webview"
      />
    </>
  )
}

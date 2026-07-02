import { useEffect, useRef, useState, type Ref } from 'react'

/**
 * The ONE widget surface — both web widgets and native extensions render here. A webview loads the
 * extension's garret://<id>/ UI with the extBridge preload; the guest self-binds (main verifies the
 * origin). Primitive-agnostic lifecycle: if we ever swap <webview> for WebContentsView, only this
 * file changes, not the SDK contract (docs § Pre-SDK #2).
 *
 * Crash isolation: a crashed/failed guest process shows a widget-level state + Retry, never taking
 * down the board or other widgets (docs § Pre-SDK #3).
 */
interface Props {
  extensionId: string
  instanceId: string
  /** garret://<id>/ */
  uiUrl: string
  /** file:// URL of the extBridge preload. */
  preloadUrl: string
}

export function WidgetSurface({ extensionId, instanceId, uiUrl, preloadUrl }: Props): JSX.Element {
  const ref = useRef<HTMLElement | null>(null)
  const [crashed, setCrashed] = useState(false)
  const [nonce, setNonce] = useState(0) // bump to remount the webview on Retry

  useEffect(() => {
    const wv = ref.current
    if (!wv) return
    const onGone = (): void => setCrashed(true)
    const onFail = (e: Event): void => {
      // -3 == ABORTED (navigation replaced) — ignore; real load failures show the crashed state.
      if ((e as unknown as { errorCode?: number }).errorCode !== -3) setCrashed(true)
    }
    wv.addEventListener('render-process-gone', onGone)
    wv.addEventListener('unresponsive', onGone)
    wv.addEventListener('did-fail-load', onFail)
    return () => {
      wv.removeEventListener('render-process-gone', onGone)
      wv.removeEventListener('unresponsive', onGone)
      wv.removeEventListener('did-fail-load', onFail)
    }
  }, [nonce])

  if (crashed) {
    return (
      <div className="widget-crashed">
        <span>{extensionId} stopped</span>
        <button
          onClick={() => {
            setCrashed(false)
            setNonce((n) => n + 1)
          }}
        >
          Reload
        </button>
      </div>
    )
  }

  return (
    <webview
      key={nonce}
      ref={ref as unknown as Ref<HTMLWebViewElement>}
      src={`${uiUrl}?instance=${encodeURIComponent(instanceId)}`}
      preload={preloadUrl}
      partition="persist:garret-ext"
      // eslint-disable-next-line react/no-unknown-property
      webpreferences="contextIsolation=yes,nodeIntegration=no,sandbox=no"
      className="widget-webview"
    />
  )
}

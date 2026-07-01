import { useEffect, useRef, type Ref } from 'react'

/** Minimal handle onto Electron's <webview> element. */
type WebviewEl = HTMLElement & { getWebContentsId: () => number }

interface Props {
  extensionId: string
  /** file:// URL of the extension's UI entry. */
  uiUrl: string
  /** file:// URL of the shared native-bridge preload. */
  preloadUrl: string
}

/**
 * Renders a NATIVE extension's UI in a webview and binds it to its raw-Node host: on attach we
 * ask main to launch the host bound to this webview's webContents id; the UI's preload
 * (`window.garret.native`) then routes requests/events to that host. The UI webview itself has
 * no Node — the raw power lives in the isolated utilityProcess host.
 */
export function NativeWidget({ extensionId, uiUrl, preloadUrl }: Props): JSX.Element {
  const ref = useRef<WebviewEl | null>(null)

  useEffect(() => {
    const wv = ref.current
    if (!wv) return
    let wcId = -1
    const onAttach = (): void => {
      wcId = wv.getWebContentsId()
      void window.garret.nativeExt.start(extensionId, wcId)
    }
    wv.addEventListener('did-attach', onAttach)
    return () => {
      wv.removeEventListener('did-attach', onAttach)
      if (wcId >= 0) window.garret.nativeExt.stop(wcId)
    }
  }, [extensionId])

  return (
    <webview
      ref={ref as unknown as Ref<HTMLWebViewElement>}
      src={uiUrl}
      preload={preloadUrl}
      partition="persist:garret-native"
      webpreferences="contextIsolation=yes,nodeIntegration=no,sandbox=no"
      className="widget-webview"
    />
  )
}

import { useEffect, useRef, useState, type Ref } from 'react'
import type { GuestMessage } from '@sdk'
import { SANDBOX_API_VERSION } from '@renderer/sandbox/constants'
import { BridgeHost } from '@renderer/sandbox/BridgeHost'

/** Minimal handle onto Electron's <webview> (avoids pulling electron types into the renderer). */
type WebviewEl = HTMLElement & {
  send: (channel: string, ...args: unknown[]) => void
  setWebRTCIPHandlingPolicy: (policy: string) => void
}

/** Electron's webview `ipc-message` event (not in the renderer DOM typings). */
type WebviewIpcEvent = Event & { channel: string; args: unknown[] }

interface Props {
  /** Stable installed-widget id — drives the origin, partition, and storage namespace. */
  widgetId: string
  instanceId: string
  config: Record<string, unknown>
  refreshToken: number
  permissions: string[]
  apiVersion: number
  /** Persist a config patch the widget requested (ctx.updateConfig). */
  onUpdateConfig: (patch: Record<string, unknown>) => void
}

/**
 * Renders one third-party widget inside an isolated, out-of-process <webview> and
 * mediates it through a {@link BridgeHost}. The partition session guards are installed
 * (main) BEFORE the webview mounts, so the first navigation is already protected.
 * See docs/sandbox-design.md §7.
 */
export function SandboxWidget(props: Props): JSX.Element {
  const { widgetId, instanceId, config, refreshToken, permissions, apiVersion, onUpdateConfig } = props
  const ref = useRef<WebviewEl | null>(null)
  const bridgeRef = useRef<BridgeHost | null>(null)
  const [prep, setPrep] = useState<{ preloadUrl: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const partition = `garret-widget-${widgetId}`
  const incompatible = apiVersion > SANDBOX_API_VERSION

  // 1) Configure the partition session guards BEFORE the webview renders/navigates.
  useEffect(() => {
    if (incompatible) return
    let cancelled = false
    window.garret.sandbox
      .prepare(partition)
      .then((r) => !cancelled && setPrep(r))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
    }
  }, [partition, incompatible])

  // 2) Wire the BridgeHost to the webview once it exists. Latest config/token via refs so
  //    onReady reads current values without re-running this effect.
  const latest = useRef({ config, refreshToken })
  latest.current = { config, refreshToken }
  useEffect(() => {
    if (!prep) return
    const wv = ref.current
    if (!wv) return
    const bridge = new BridgeHost({
      widgetId,
      permissions,
      // Best-effort: during unmount the <webview> is detached/destroyed and .send()
      // throws ("must be attached to the DOM"). Swallow it — a throw here escapes the
      // effect cleanup past this widget's (also-unmounting) error boundary and would
      // blank the whole board.
      send: (msg) => {
        try {
          wv.send('garret:msg', msg)
        } catch {
          /* guest gone (teardown/reload) — nothing to deliver to */
        }
      },
      onUpdateConfig,
      onReady: () => bridge.init(instanceId, latest.current.config, latest.current.refreshToken)
    })
    bridgeRef.current = bridge
    const onIpc = (e: Event): void => {
      const ev = e as WebviewIpcEvent
      if (ev.channel === 'garret:msg') bridge.handle(ev.args[0] as GuestMessage)
    }
    // WebRTC bypasses CSP; kill IP leakage as early as possible (before the guest doc loads).
    // Best-effort + guarded: the call throws if the webContents isn't ready yet, and an
    // uncaught throw in this listener would surface as a console error / break wiring.
    const onAttach = (): void => {
      try {
        wv.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')
      } catch {
        /* webContents not ready on this event — a later did-attach/dom-ready retries */
      }
    }
    wv.addEventListener('ipc-message', onIpc)
    wv.addEventListener('did-attach', onAttach)
    wv.addEventListener('dom-ready', onAttach)
    return () => {
      wv.removeEventListener('ipc-message', onIpc)
      wv.removeEventListener('did-attach', onAttach)
      wv.removeEventListener('dom-ready', onAttach)
      bridge.dispose()
      bridgeRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prep, widgetId, instanceId])

  // Push config / refresh changes to the running guest (no reload).
  useEffect(() => {
    bridgeRef.current?.pushConfig(config)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(config)])
  useEffect(() => {
    if (refreshToken > 0) bridgeRef.current?.pushRefresh()
  }, [refreshToken])

  if (incompatible) {
    return <div className="widget-placeholder">This widget needs a newer version of Garret.</div>
  }
  if (error) return <div className="widget-placeholder">Sandbox error: {error}</div>
  if (!prep) return <div className="widget-placeholder">Loading…</div>

  return (
    <webview
      ref={ref as unknown as Ref<HTMLWebViewElement>}
      src={`garret-widget://${widgetId}/`}
      partition={partition}
      preload={prep.preloadUrl}
      webpreferences="contextIsolation=yes,sandbox=yes,nodeIntegration=no"
      className="widget-webview"
    />
  )
}

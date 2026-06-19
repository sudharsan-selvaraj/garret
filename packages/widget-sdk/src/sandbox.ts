import * as React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { BridgeTransport, HostMessage, WidgetContext, WidgetPlugin } from 'garret-core'
import { createSDK } from './createSDK'
import { createBridgeClient } from './bridgeClient'

declare global {
  interface Window {
    __garretBridge?: BridgeTransport
  }
}

/**
 * Boot a widget inside the sandbox (the webview guest). A built widget bundle's entry
 * calls `runWidget(myWidget)`; this wires the host bridge, builds the realm SDK with the
 * widget's own React, and mounts/refreshes the widget. The host injects `__garretBridge`
 * via the bridge-preload (contextBridge). One bridge/sdk per load (per the createSDK
 * lifecycle note). See docs/sandbox-design.md §5.
 */
export function runWidget(plugin: WidgetPlugin): void {
  const transport = window.__garretBridge
  if (!transport) {
    throw new Error('garret: no host bridge — runWidget must execute inside the Garret sandbox')
  }

  const { client, accept } = createBridgeClient(transport)
  const sdk = createSDK(React, client)

  let root: Root | null = null
  let config: Record<string, unknown> = {}
  let instanceId = ''
  let refreshToken = 0

  const ctx: WidgetContext = {
    get instanceId() {
      return instanceId
    },
    get refreshToken() {
      return refreshToken
    },
    storage: client.storage,
    updateConfig: (patch) => transport.post({ kind: 'updateConfig', patch })
  }

  const mount = (): void => {
    if (!root) {
      const el = document.getElementById('root') ?? document.body
      root = createRoot(el)
    }
    root.render(React.createElement(plugin.render, { config, ctx, sdk }))
  }

  let off: (() => void) | undefined
  off = transport.onMessage((msg: HostMessage) => {
    if (accept(msg)) return // result / error / event handled by the bridge client
    switch (msg.kind) {
      case 'init':
        instanceId = msg.instanceId
        config = msg.config
        refreshToken = msg.refreshToken
        mount()
        break
      case 'config':
        config = msg.config
        mount()
        break
      case 'refresh':
        refreshToken += 1
        mount()
        break
      case 'teardown':
        root?.unmount()
        root = null
        off?.()
        break
    }
  })

  // Attach the listener (above) BEFORE announcing readiness so the host's `init` can't race us.
  transport.post({ kind: 'ready' })
}

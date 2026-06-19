import * as React from 'react'
import { defineWidget, type WidgetRenderProps } from 'garret-widget-sdk'
import { runWidget } from 'garret-widget-sdk/sandbox'

/**
 * A sandboxed widget that probes each capability on render and reports the result, so
 * adding it visually runs the Phase-3 acceptance suite. Declares only:
 *   network:api.github.com (a real, public host) and network:localtest.me (resolves to
 *   127.0.0.1 — to prove the resolved-IP rebind gate) and openExternal.
 */
function SelfTest({ sdk }: WidgetRenderProps): JSX.Element {
  const [rows, setRows] = React.useState<Array<{ label: string; ok: boolean; detail: string }>>([])
  const add = (label: string, ok: boolean, detail: string): void =>
    setRows((r) => [...r, { label, ok, detail }])

  React.useEffect(() => {
    add('render', true, 'widget mounted in sandbox')

    sdk
      .fetch('https://api.github.com/repos/sudharsan-selvaraj/garret')
      .then((r) => add('permitted fetch', r.ok, r.ok ? `${r.status}` : `unexpected: ${r.error}`))
      .catch((e) => add('permitted fetch', false, String(e)))

    sdk
      .fetch('https://example.com/')
      .then((r) => add('undeclared host', !r.ok, r.ok ? 'LEAK — should be blocked' : r.error || 'blocked'))

    sdk
      .fetch('http://localtest.me/')
      .then((r) => add('rebind→127.0.0.1', !r.ok, r.ok ? 'LEAK — should be blocked' : r.error || 'blocked'))

    sdk.services
      .query('atlassian', 'listPRs', {})
      .then(() => add('undeclared service', false, 'LEAK — should be denied'))
      .catch((e) => add('undeclared service', true, e.message))

    sdk.services
      .connect('google', {})
      .then(() => add('services.connect', false, 'LEAK — should be blocked'))
      .catch((e) => add('services.connect', true, e.message))

    const val = `v-${Date.now()}`
    sdk.storage
      .set('probe', val)
      .then(() => sdk.storage.get<string>('probe'))
      .then((got) => add('storage roundtrip', got === val, `wrote ${val}, read ${got}`))
  }, [sdk])

  return (
    <div style={{ font: '12px -apple-system, sans-serif', padding: 10, color: '#e6e6ea' }}>
      <strong style={{ fontSize: 13 }}>Sandbox self-test</strong>
      <ul style={{ listStyle: 'none', padding: 0, marginTop: 8 }}>
        {rows.map((r, i) => (
          <li key={i} style={{ marginBottom: 4 }}>
            <span style={{ color: r.ok ? '#30d158' : '#ff453a' }}>{r.ok ? '✓' : '✗'}</span>{' '}
            <b>{r.label}</b> — {r.detail}
          </li>
        ))}
      </ul>
      <button onClick={() => sdk.openExternal('https://github.com/sudharsan-selvaraj/garret')}>
        openExternal (should confirm)
      </button>
    </div>
  )
}

runWidget(
  defineWidget({
    apiVersion: 1,
    manifest: {
      id: 'sandbox-selftest',
      name: 'Sandbox Self-Test',
      defaultSize: { w: 5, h: 6 },
      permissions: ['network:api.github.com', 'network:localtest.me', 'openExternal'],
      configSchema: {}
    },
    render: SelfTest
  })
)

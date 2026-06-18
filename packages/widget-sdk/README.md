# garret-widget-sdk

Build widgets for [Garret](https://github.com/sudharsan-selvaraj/garret) — the macOS
desktop layer for developer focus.

A widget declares a **manifest** (what it is, its config, the capabilities it needs) and
a **render** component. The framework injects an **`sdk`** — typed live-data hooks bound
to a host capability client — so the same widget code runs in the native host today and
in an isolated sandbox tomorrow; only the injected `sdk`'s transport differs.

## Install

```bash
npm i garret-widget-sdk react lucide-react
```

`react` and `lucide-react` are peer dependencies. Ships dual ESM + CJS.

## Define a widget

```tsx
import { defineWidget, field, type WidgetRenderProps } from 'garret-widget-sdk'

interface Config {
  repo: string
}

export default defineWidget<Config>({
  apiVersion: 1, // host contract version (host rejects incompatible majors)
  manifest: {
    id: 'github-issues',
    name: 'GitHub Issues',
    defaultSize: { w: 4, h: 4 },
    // Capabilities you need — shown at install, enforced by the sandbox.
    permissions: ['network:api.github.com'],
    configSchema: {
      repo: field.text({ label: 'Repository', placeholder: 'owner/name', required: true })
    }
  },
  render({ config, sdk }: WidgetRenderProps<Config>) {
    // `sdk` is injected by the host — never call createSDK yourself in production.
    const { data, loading, error } = sdk.usePolledQuery<{ title: string }[]>(
      'github', 'issues', { repo: config.repo }
    )
    if (loading) return <p>Loading…</p>
    if (error) return <p>Failed: {error}</p>
    return <ul>{data?.map((i) => <li key={i.title}>{i.title}</li>)}</ul>
  }
})
```

`sdk` exposes `usePolledQuery`, `useServiceStatus`, `useFileWatch`, `services`, `fetch`
(host-mediated HTTP, no CORS), `storage` (per-widget), and `openExternal` — the same
surface Garret's built-in widgets use.

## Test it — no Garret required

`garret-widget-sdk/testing` gives you a fake host client, so you build the `sdk` yourself
and render in jsdom (vitest / jest + @testing-library/react):

```tsx
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { createSDK } from 'garret-widget-sdk'
import { createMockClient } from 'garret-widget-sdk/testing'
import Widget from './widget'

test('renders issues', async () => {
  const sdk = createSDK(React, createMockClient({
    query: async (_id, method) => (method === 'issues' ? [{ title: 'A bug' }] : [])
  }))
  const Render = Widget.render
  render(<Render config={{ repo: 'a/b' }} ctx={fakeCtx} sdk={sdk} />)
  expect(await screen.findByText('A bug')).toBeInTheDocument()
})
```

`createMockClient` also fakes `fetch`/`storage` and returns `emitPoll(update)` /
`emitWatch(id)` so you can drive live-refresh paths.

## Layers

- **`garret-core`** — pure, no React: types, `field` + validators, `canonicalKey`, the
  `GarretClient` capability interface, and `GarretSDK`. Re-exported from this package.
- **`garret-widget-sdk`** — `createSDK(React, client)` (the realm-bound hook logic) +
  `WidgetStatus`.

> Internals: the host calls `createSDK(React, client)` **once per widget realm** and
> injects the result as `WidgetRenderProps.sdk`. A sandbox runtime must create a fresh
> sdk per iframe load (don't reuse one across mounts).

## Status

Authoring + unit-testing work today. The **host runtime** that loads a third-party widget
and injects a live, permission-enforced `client` (the sandboxed iframe + postMessage
bridge) is in progress — the prerequisite for distributing widgets to other users.

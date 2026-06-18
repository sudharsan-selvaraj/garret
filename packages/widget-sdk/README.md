# garret-widget-sdk

Build widgets for [Garret](https://github.com/sudharsan-selvaraj/garret) — the macOS
desktop layer for developer focus.

A widget is a small module that declares a **manifest** (what it is, its config) and a
**render** component. The SDK gives you typed config fields (which auto-generate the
settings form + validation) and live polling / file-watch hooks. The hooks are bound to
a host **capability client** via `createSDK(React, client)`, so the very same widget code
runs in the native host and (when the sandbox tier lands) in an isolated iframe — only
the injected `React` and `client` differ.

## Install

```bash
npm i garret-widget-sdk react lucide-react
```

`react` and `lucide-react` are peer dependencies.

## Define a widget

```tsx
import { defineWidget, field, type WidgetRenderProps } from 'garret-widget-sdk'

interface Config {
  repo: string
}

export default defineWidget<Config>({
  manifest: {
    id: 'github-issues',
    name: 'GitHub Issues',
    defaultSize: { w: 4, h: 4 },
    configSchema: {
      repo: field.text({ label: 'Repository', placeholder: 'owner/name', required: true })
    }
  },
  render({ config, ctx }: WidgetRenderProps<Config>) {
    // hooks come from an `sdk` created with createSDK(React, client) — see below.
    return <div>Issues for {config.repo}</div>
  }
})
```

## Use the hooks — `createSDK(React, client)`

The hooks (`usePolledQuery`, `useServiceStatus`, `useFileWatch`) are produced by binding
the SDK to a realm's React and a `GarretClient`:

```ts
import * as React from 'react'
import { createSDK } from 'garret-widget-sdk'

const sdk = createSDK(React, client) // `client` is provided by the host runtime
const { data, loading, error } = sdk.usePolledQuery('github', 'issues', { repo })
```

In Garret's built-in widgets the app supplies a `client` backed by the host. For your own
widget you test against a **mock** client today, and the in-host runtime that injects the
live client into distributed widgets arrives with the **sandbox tier** (see Status).

## Test it — no Garret required

`garret-widget-sdk/testing` provides a fake `GarretClient`, so you can render and assert
in jsdom (vitest / jest + @testing-library/react):

```tsx
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { createSDK } from 'garret-widget-sdk'
import { createMockClient } from 'garret-widget-sdk/testing'

const sdk = createSDK(React, createMockClient({
  query: async (_id, method) => (method === 'issues' ? [{ title: 'A bug' }] : [])
}))
// render a component that uses sdk.usePolledQuery(...) and assert on the output.
```

`createMockClient` also returns `emitPoll(update)` / `emitWatch(id)` to drive live-refresh
paths in a test.

## Layers

- **`garret-core`** — pure, no React: types, `field` + validators, `canonicalKey`, and the
  `GarretClient` capability interface. Re-exported from this package.
- **`garret-widget-sdk`** — `createSDK(React, client)` (the realm-bound hook logic) +
  `WidgetStatus`.

## Status

Authoring + unit-testing work today. The **host runtime** that loads a third-party widget
and injects a live, permission-enforced `client` (the sandboxed iframe + postMessage
bridge) is in progress — it's the prerequisite for distributing widgets to other users.
Until then, widget code runs only in the trusted-local dev tier (you load your own code).

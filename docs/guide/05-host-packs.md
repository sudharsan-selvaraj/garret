# 5 · Host packs

[← Build a widget](04-build-a-widget.md) · Next: [Publishing →](06-publishing.md)

Most widgets are pure UI. Add a **host** only when the sandbox genuinely can't do the job:

- **OAuth** with a loopback redirect (needs a local HTTP server).
- **Local processes / binaries** (e.g. `adb`, `scrcpy` in the device-control pack).
- Anything needing raw Node APIs.

A host runs in an Electron `utilityProcess` — raw Node, no renderer, no capability sandbox. That
power is why a host earns a **"runs code on your computer" notice at install**. Declare it in the
manifest and it's launched automatically when the widget mounts.

```json
{
  "id": "calendar",
  "ui": "dist/calendar",
  "host": "dist/host/index.cjs",
  "capabilities": ["secrets", "openExternal"]
}
```

> `capabilities` still gate the **UI** side (`g.*`). The host itself is unrestricted.

## The host module

```ts
// host/index.ts
import { defineHost, type HostContext } from '@garretapp/sdk/host'
import type { Api, Events } from '../shared/api'   // your host↔UI contract

export default defineHost<Api, Events>((ctx) => ({
  async fetchThings({ token }) {
    const res = await fetch('https://api.example.com/things', {
      headers: { Authorization: `Bearer ${token}` }
    })
    return (await res.json()).items
  }
}))
```

`ctx` gives the host: `storage`, `secrets`, `shared`, `fetch`, `spawn`/`spawnShell`/`resolveBinary`,
`emit` (push events), `stream` (push chunks), `onDispose`, `log`. See
[SDK reference §Host runtime](07-sdk-reference.md#host-runtime).

## Calling the host from the UI

```tsx
import { useHost, useHostEvent } from '@garretapp/sdk/react'
import type { Api, Events } from '../../shared/api'

function App() {
  const host = useHost<Api, Events>()
  useHostEvent<Events, 'things:changed'>('things:changed', (list) => setThings(list))
  useEffect(() => { void host.fetchThings({ token }).then(setThings) }, [host])
}
```

- `useHost<Api,Events>()` — a typed proxy of your host methods (Promise or Stream, inferred).
- `useHostEvent(channel, cb)` — subscribe to events the host `emit`s.
- The `Api`/`Events` types live in a shared file (`shared/api.ts`) imported by both sides.

## Pattern: OAuth in a host

The host can't open a browser (no Electron `shell`), so split the flow: the **host** runs the loopback
server + token exchange and **emits the auth URL**; the **UI** opens it with `g.openExternal`.

```ts
// host: runOAuth emits the URL instead of opening it
server.listen(0, '127.0.0.1', () => {
  const url = `${AUTH_URL}?${params}`   // redirect_uri = http://127.0.0.1:<port>
  ctx.emit('auth:url', { url })          // ← UI opens this
})
// …capture the loopback redirect, exchange the code (PKCE), return { refreshToken, email }
```

```tsx
// UI
useHostEvent<Events, 'auth:url'>('auth:url', ({ url }) => void g.openExternal(url))
const connect = async () => {
  const { refreshToken, email } = await host.connect({ clientId, clientSecret })
  await g.secrets.set('refreshToken', refreshToken)
  await g.storage.set('email', email)
}
```

Keep persistence in the **UI** (`g.secrets`/`g.storage`) and pass credentials into host calls — the
host stays a stateless compute engine, and you sidestep host↔UI store-namespace questions. The
`garret.google` pack is the reference implementation.

## Gotchas

- **`secrets` capability** — the UI needs it to read/write via `g.secrets`; `g.storage` is free.
- **Import CSS from `main.tsx`** so the bundler emits `app.css`; link `app.css` in `index.html`.
- **Bind timing** — gate the first `g.storage`/`g.secrets` read on `useInstanceConfig`'s `loaded` flag,
  or you'll hit `widget not bound`.
- **Icons** — the published SDK ships no icon set; if you want lucide icons, add `lucide-react` to your
  packs repo (see [Publishing](06-publishing.md)).

Next: [Publishing →](06-publishing.md)

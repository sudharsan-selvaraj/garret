# External Widget Contract

> **⚠️ Partially superseded.** The **trusted-local / dev tier** described here (self-authored
> widgets in `external-widgets/`, registry prefix `ext:`, sharing the `garret-widget-sdk` plugin
> shape with the first-party built-ins) is **still current**. But the anticipated **third-party
> "sandboxed" tier** was replaced by the unified **`@garretapp/sdk`** extension path (one authoring
> model, `garret://` scheme, tier derived from capabilities) — see [`architecture.md`](./architecture.md)
> and [`garret.html`](./garret.html). Read the "move into the sandbox" framing below as historical.

The durable contract for community/external widgets in Garret. The goal: **first-party
(native) and third-party (sandboxed) widgets share the same logic** — only the React
instance and the transport differ per realm, so nothing is duplicated and today's
widgets survive the move into the sandbox.

## Trust model (decided)

Two tiers, gated by **distribution**, not preference:

- **Trusted-local** (today): self-authored / "load-unpacked" widgets in `external-widgets/`.
  Executed via `new Function` in the host realm with full SDK access. *Installing it is the
  trust decision.* Must be labeled "runs with full access — only load code you trust." Dev /
  power-user only; **cannot ship under a production CSP** (so this tier never reaches
  distribution).
- **Sandboxed** (required before ANY share/marketplace/URL channel): the widget runs in an
  isolated iframe with its own realm, bundles its own React + `@garret/widget-sdk`, and talks
  to the host only over a postMessage capability bridge that **enforces declared permissions**.
  Secrets never cross the bridge (host runs `services.query` and returns results, never tokens).

**Rule:** the sandbox is the *entry ticket to distribution* — built **before** the channel
opens, never retrofitted after third-party widgets are live.

## SDK layering (the concrete core)

Three layers. The hook *logic* lives once; only binding differs per realm.

```
@garret/core        — pure, no React, no transport.
                      types · field descriptors · formatters · validators ·
                      request builders · canonicalKey. Shared VERBATIM by all realms.

createSDK(React, client)  — hook LOGIC written once; bound to a realm's React + client.
                      returns { usePolledQuery, usePoll, useServiceStatus,
                                useFileWatch, field, ...core }
                      Native:  createSDK(hostReact,  ipcClient)
                      Sandbox: createSDK(widgetReact, bridgeClient)   // inside the widget bundle

GarretClient        — one async, serializable interface; two transports.
                      ipcClient    → window.garret.*          (native, same realm)
                      bridgeClient → postMessage to the host  (sandbox; host enforces perms)
```

### `GarretClient` interface (all async + serializable — survives the bridge)
As shipped in `garret-core` (v0.0.2). Service calls are namespaced under `services`
(connect/disconnect/status used by settings flows, not just `query`):
```ts
interface GarretClient {
  services: {
    status(id): Promise<ServiceStatus>; connect(id, creds): Promise<ServiceStatus>
    disconnect(id): Promise<ServiceStatus>; query<T>(id, method, params): Promise<T>
  }
  poll: { subscribe(subId, key, …): Promise<PollUpdate>; unsubscribe(subId); refresh(key); onUpdate(cb): () => void }
  watch: { subscribe(watchId, paths, opts); unsubscribe(watchId); onEvent(cb): () => void } // perm-gated
  fetch(url, init?): Promise<{ ok; status; data?; error? }>                                   // host-mediated, no CORS
  storage: { get<T>(key): Promise<T|undefined>; set(key, value): Promise<void> }              // per-widget scoped
  openExternal(url: string): void
}
```
`onUpdate`/`onEvent` take callbacks: over the postMessage bridge they map to message
subscriptions (the host pushes; you can't post a function reference).

### SDK injection (decided, v0.0.2)
The host calls `createSDK(React, client)` **once per widget realm** and injects the result
as **`WidgetRenderProps.sdk`** (and `WidgetSettingsProps.sdk`). A widget never calls
`createSDK` itself, so the same `render` runs native or sandboxed. `GarretSDK` lives in
`garret-core` so the props type can reference it without depending on the React binding.

**Why this works:** a React hook is "logic + a React binding." The logic (subscribe, diff,
setState) is realm-agnostic; only `useState`/`useEffect` (per-realm React) and the transport
(`client`) are not. So hooks are **never duplicated** — `createSDK` re-binds the same bodies in
each realm (~10 lines of binding). Capabilities are async/serializable specifically so the same
calls work whether the transport is a direct IPC call or a postMessage round-trip.

### Discipline to keep NOW (cheap insurance)
Hook bodies must **not hard-wire `window.garret`** — route transport through a `client`.
Today `usePolledQuery`/`useFileWatch` call `window.garret.*` directly; the sandbox refactor
swaps that for a `client` param. Keeping the transport calls in one thin place makes this a
mechanical change, not a rewrite.

## Widget package / manifest
```ts
{
  apiVersion: 1,                       // host rejects incompatible majors
  manifest: {
    id, name, icon?, description?,
    defaultSize, minSize?,
    permissions: string[],             // 'service:atlassian' | 'network:api.github.com'
                                       // | 'clipboard:read' | 'files:read' | 'storage'
    configSchema
  },
  render
}
```
- Loader assigns a **namespaced id** (`ext:<file>:<id>`) — no collision with built-ins.
- `permissions` are **data from day one** (declared + logged now; **enforced** at the bridge later).

## The "validator" — disclosure, never a verdict
Static analysis CANNOT prove safety (obfuscation, computed access, fetch-then-eval, minified
code; intent is undecidable). So:
- **Never** emit a "✅ safe / ❌ unsafe" badge — it's false confidence + liability.
- **Do** surface: (a) **capability disclosure** from `permissions` at the consent screen, and
  (b) **declared-vs-actually-used mismatch** ("declares `network:api.github.com` but also calls
  `services.query('atlassian')` and reads the clipboard — *undeclared*"). That diff is honest,
  high-signal transparency — and it's the exact content of the install-consent screen.

## Author trust (for distribution — must be real, not a display name)
1. **Verifiable provenance** — code bound to an identity: signed package (author key) or origin-
   pinned install (`github.com/org/repo`), not a self-declared string.
2. **Integrity** — signature/hash; the code you run is the code the author published.
3. **Re-consent on capability change** — a benign v1 cannot silently become a v2 that adds
   `clipboard`/new hosts; new permissions ⇒ new prompt.
4. **Legible disclosure** at install (the validator output above).

Provenance reduces *likelihood*; isolation reduces *impact*. Distribution needs both.

## Status
**Hardened this session (trusted-local tier):** `apiVersion` + frozen `garret`; loader-assigned
namespaced ids + shape validation; bounded `fetchJson` (http(s), 10s, 5MB); `garret`-only static
guard; `permissions` declared+logged; `usePoll` fn-ref. See `BACKLOG.md` for the sandbox work.

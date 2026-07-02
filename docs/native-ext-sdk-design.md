# `garret-ext` SDK — design (rev 2)

> **⚠️ Historical / design basis.** This is the **design basis for `@garretapp/sdk`** — most of it
> shipped (typed bridge, callback-handle streaming, `defineHost`/`useHost`/`ctx.stream`). What
> changed since: the two-tier assumptions here were **unified** into one authoring path, tier is now
> **derived** from declared capabilities, the package is `@garretapp/sdk` (package `packages/sdk`,
> subpaths `/host` `/ui` `/react`), and the wire uses first-class `stream_*` frames. See
> `docs/architecture.md` (reconciliation banner + old→new file-path map) and `docs/garret.html` for
> the shipped contract.

A wrapper that fixes the pain points in `docs/native-ext-dx-review.md` (P1–P10). Decisions locked
with the user: **callback-handle streaming**, **full scope**. Two runtime worlds stay two worlds
(the UI still can't `import fs`) — the SDK makes crossing the bridge typed, streamable, boilerplate-free.

## rev 2 — critic deltas (adversarial security + API review, folded in)

Verdict was **build-with-BLOCKERS-fixed** (architecture sound, does not weaken Phase-3 guarantees).
These override the rev-1 details below:

**BLOCKERS**
- **B1 — stream marker must resolve synchronously, before `fn` runs.** `extensionHost.request()`
  has a 15 s timeout; if a stream method awaits anything before returning `{__gxStream:id}` the
  call can time out and kill the run pre-first-chunk. `ctx.stream(fn)` returns the marker
  **immediately** (host replies `{t:'res', ok, value:{__gxStream:id}}` synchronously) and schedules
  `fn(out, signal)` on the next tick — `fn` never blocks the marker. Document this ordering.
- **B2 — bound the pre-attach chunk buffer.** The client buffers `__gx_stream` events that arrive
  before `.onData` attaches; unbounded, an un-consumed firehose grows renderer memory forever. Cap
  the per-stream buffer (drop-oldest, set an `overflow` flag surfaced on first `.onData`), and
  **auto-cancel a stream with no handler attached within a microtask**.
- **B3 — pin the GCM construction.** `ctx.secrets` stores **per value** `{v:1, nonce, tag, ct}`
  with `nonce = randomBytes(12)` generated **per `set`** (never derived/counter/reused — GCM nonce
  reuse is catastrophic). Verify tag on `get`; on failure throw `INTERNAL`. The key
  (`GARRET_EXT_SECRET_KEY`) is **static for the install** — no rotation; a safeStorage/Keychain
  reset orphans all ciphertext → `get` **fails closed** (throws `UNAVAILABLE`), never crashes.

**SHOULD-FIX (folded)**
- **`ctx.spawn` scrubs `GARRET_EXT_*` from the child env by default** (opt-in to re-add). Otherwise
  the vault key leaks into every `adb`/`scrcpy`/shell the extension spawns — programs the author
  didn't write. Keep env injection to the host; strip at the spawn boundary.
- **`ctx.storage` does key-level merge, not last-write-wins.** Before temp+rename, re-read the
  namespace file under the in-process write lock and merge only the changed key → concurrent
  instances no longer clobber each other's *unrelated* keys (same-key cross-process is still racy;
  documented). Kills the P6 data-loss footgun without a DB.
- **Orphan GC.** On startup, remove `ext-data/*` whose `<id>` has no install record. In
  `removeExtension`, delete the **data dir + secret before** the code dir, so a crash mid-uninstall
  leaves a harmless orphan code dir (re-GC'd), never an orphan decryptable secret.
- **`StreamCall` is NOT thenable.** Overloading `await` on a stream is a footgun (awaiting an
  endless `logcat` hangs; `Promise.resolve(call)` fires `.then` early, forcing the buffer race).
  Mode is chosen from the **static `Api` type** (`Stream<C,R>` → `StreamCall`, else `Promise<R>`),
  never the runtime response. `StreamCall` exposes `.onData/.onEnd/.onError/.cancel` and, for
  *bounded* streams, `.result()` (a promise resolving on end). Plain methods stay awaitable.
- **Backpressure v1 = coalesce-only, honestly scoped.** `out.push` microtask-coalesces host→parent,
  but can't see the slow main→renderer→`.onData` hops. Ship that + document that firehoses
  (`adb logcat`) must be **filtered host-side** (e.g. `grep` in the spawn). Credit-based flow
  control (renderer→host acks) is deferred, not pretended.
- **P9 committed, not "encouraged".** The factory receives the resolved method table so a method can
  call a sibling: `defineHost((ctx, methods) => ({ restart: async () => { await methods.stop(); … } }))`.
  Don't rely on toolkit-style guidance to prevent the `stop is not defined` class.
- **Payload contract = structured-clone-only.** `utilityProcess.postMessage` uses structured clone:
  `Date`/`Map`/`TypedArray`/`ArrayBuffer` survive; **functions, live handles, class prototypes do
  not**. Document it. Binary (`adb pull`) travels as `Uint8Array`/`ArrayBuffer` (no base64 bloat).
- **Scaffold vite config bakes in the CSP-safe build:** `build.modulePreload.polyfill = false`
  (the polyfill uses `fetch` → blocked by `connect-src 'none'`), **no WASM** in the UI
  (`script-src` lacks `wasm-unsafe-eval`), same-origin hashed assets only. Otherwise authors get
  blank-screen-no-error — the exact P10 failure the SDK exists to kill.

**NITs:** drop `GARRET_EXT_ID` (main injects `GARRET_EXT_DATA_DIR` directly; SDK never derives the
path); `defineHost` rejects an `Api` method named `__gx_cancel` and the demux ignores a user
`emit('__gx_stream')`; `resolveBinary` probes **both** `/opt/homebrew/bin` and `/usr/local/bin`;
`defineHost` sends `ready` **only after** the factory resolves (a throw hits piped stderr + the 10 s
`readyTimer` surfaces it).

---

## 1. Package shape

New workspace package `packages/ext-sdk` → published as **`garret-ext`**, three subpath entries the
author bundles into their extension:

- `garret-ext/host` — runs INSIDE the utilityProcess (raw Node). `defineHost`, the `ctx` toolkit.
- `garret-ext/client` — runs in the UI webview. `createClient<Api,Events>()` over `window.garret.native`.
- `garret-ext/react` — `useHost`, `useHostEvent` (+ auto-dispose) over the client.
- `garret-ext` (root) — shared types (`Stream`, `GarretError`) + the internal wire constants.

Authors bundle it (vite for UI, esbuild for host). Nothing is injected as a runtime global — it's a
normal lib.

## 2. What's in-process vs. needs main

The host toolkit is **almost** self-contained. Two things only main can provide, so main injects
them into the fork's **env at launch** (no new reverse channel needed):

- `GARRET_EXT_ID` — the extension id.
- `GARRET_EXT_DATA_DIR` — a writable per-extension data dir (§5).
- `GARRET_EXT_SECRET_KEY` — 32-byte hex key for `ctx.secrets`, or absent if safeStorage is down (§5).

Main-side changes (small):
- `extensionHost.ts`: `launchExtension(hostId, entryFile, extraEnv)` merges `extraEnv` into the fork env.
- `lane.ts`: on `nativeExtStart`, compute `{ GARRET_EXT_ID, GARRET_EXT_DATA_DIR, GARRET_EXT_SECRET_KEY }`
  for `ext.id` and pass them.
- `install.ts`: `extDataDir(id)` = `<userData>/ext-data/<id>/`; per-ext secret key via the secrets
  store (`ext-secret:<id>`); **`removeExtension` also deletes the data dir + the secret** (uninstall
  is clean, unlike quick-notes' orphaned `~/.garret-quick-notes`).

## 3. Host API (`garret-ext/host`)

```ts
export default defineHost<Api, Events>((ctx) => ({
  topProcesses: () => ({ rows: [...] }),                 // plain method
  start: ({ cmd }) => ctx.stream((out, signal) => {      // streaming method
    const child = ctx.spawn(cmd, { signal })
    child.stdout.on('data', (d) => out.push(d.toString()))
    child.on('close', (code) => out.end({ code }))
  }),
}))
```

`ctx` provides:
- `emit(channel, payload)` — typed events (P2).
- `stream(fn)` — returns a stream marker; `fn(out, signal)` runs with `out.push/end/error` and an
  `AbortSignal` fired on client `cancel()` or dispose (P1).
- `storage` — `get/set/delete/keys`, namespaced + atomic under the data dir (P6).
- `secrets` — `get/set/delete`, AES-256-GCM with the injected key; throws `UNAVAILABLE` if no key (P6).
- `onDispose(cb)` — run on host teardown; the SDK also auto-tracks `ctx.spawn` children + streams (P5).
- `resolveBinary(name)` — probe injected PATH + Homebrew dirs; returns path or throws
  `BINARY_NOT_FOUND` with an install hint (P7).
- `spawn(cmdOrArgv, opts)` — safe spawn (array argv or careful parse; `shell:false`), auto-tracked (P7/P8).

`defineHost` hides ALL envelope plumbing and sends `ready` automatically after setup (P4). Methods
are typed by `Api`; a bad method name / args is a compile error (P3).

## 4. Streaming wire protocol (P1)

- Reserved event channel `__gx_stream`. Reserved method `__gx_cancel`.
- Host: a method returning `ctx.stream(fn)` resolves its `res` with `{ __gxStream: <id> }`. `fn` runs;
  `out.push(c)` → `emit('__gx_stream', { id, k:'data', c })`; `out.end(v)`/resolve → `{ id, k:'end', v }`;
  throw/`out.error(e)` → `{ id, k:'err', e }`. `__gx_cancel(id)` aborts the signal + disposes.
- Client: **every call returns a hybrid `Call`** — thenable (so `await host.topProcesses()` works) AND
  a stream handle (`.onData/.onEnd/.onError/.cancel`). Under the hood it sends the request; if the
  response is a `{__gxStream:id}` marker it wires `__gx_stream` events (buffering chunks that arrive
  before `.onData` attaches); otherwise `await` resolves the plain value and `.onData` never fires.
  So the author writes `host.start({cmd}).onData(…)` or `await host.list({dir})` — the SDK picks the
  mode from the response, no `streams:[…]` list to maintain. Types map `Stream<C,R>` return →
  `StreamCall<C,R>`, else `Promise<R>`.
- **Backpressure:** `out.push` is fire-and-forget over IPC; a firehose (`yes`, fast logcat) can flood.
  v1: coalesce pushes on a microtask + a max in-flight byte budget with a `drain` await in `out.push`
  when exceeded (so tight loops self-throttle). Flagged for the critic.

## 5. Storage & secrets (P6)

- **Data dir is SEPARATE from the code dir.** Critical: the code dir is integrity-hashed by Phase 3
  (`currentHash === record.sha256`); writing state there would flip `tampered` and the extension would
  stop loading. So data lives in `<userData>/ext-data/<id>/`, injected as `GARRET_EXT_DATA_DIR`.
- `ctx.storage`: one JSON file per namespace under the data dir; writes are atomic (temp+rename) and
  serialized in-process. **Multi-instance caveat:** two placed instances of the same extension are two
  host processes sharing one data dir → cross-process write races remain (atomic-rename prevents
  corruption, not lost updates). Documented as "shared, last-write-wins"; a locked/SQLite store is
  later work.
- `ctx.secrets`: AES-256-GCM with `GARRET_EXT_SECRET_KEY` (main holds it in safeStorage, injects hex
  at launch). Ciphertext in the data dir. **Fail closed:** no key (safeStorage down) → `secrets.*`
  throws `UNAVAILABLE`, never a plaintext fallback (consistent with Phase 3's record MAC).

## 6. Errors (P7)

`GarretError { code, message }` (codes: `BINARY_NOT_FOUND`, `NOT_FOUND`, `PERMISSION`, `UNAVAILABLE`,
`BAD_ARGS`, `INTERNAL`). Bridge carries `{ ok:false, error:{ code, message } }`; the client rethrows a
`GarretError` so the UI can branch on `code` (e.g. show a `brew install` hint for `BINARY_NOT_FOUND`).

## 7. React (`garret-ext/react`)

- `useHost<Api,Events>()` — memoized client; subscriptions + streams auto-cancel on unmount (P5).
- `useHostEvent(channel, cb)` — typed per-channel subscription, cleaned up on unmount (P2).
- (nice-to-have) `useHostQuery(method, args)` → `{ data, error, loading }`.

## 8. Reference rebuild + build toolchain

Convert **command-runner** (the streaming one) into `examples/native-command-runner-react/`:
React + `shared/api.ts` + `host/index.ts`, built with vite (UI, `self`-only bundle → satisfies the
native CSP) + esbuild (host → `node/main.cjs`), one `build.mjs` emitting `dist/{ui,node}/` + manifest.
This proves the DX end to end and becomes the template a future `create-garret-ext` scaffolds.

## 9. Build order

1. `packages/ext-sdk` skeleton + shared types + wire constants.
2. `garret-ext/host`: `defineHost` + envelope + `ready`; `ctx.emit/onDispose`; typed methods (P2–P4).
3. Streaming: `ctx.stream` + `__gx_stream`/`__gx_cancel` + client hybrid `Call` (P1).
4. Main-side env injection + data dir lifecycle + per-ext secret key (P6 plumbing).
5. `ctx.storage` / `ctx.secrets` / `resolveBinary` / `ctx.spawn` + `GarretError` (P6–P8).
6. `garret-ext/client` + `garret-ext/react`.
7. Reference React rebuild + build toolchain (§8); verify install → enable → stream → persist.

## 10. Open questions (for the critic)

- **Secret key in the fork env** — is env injection acceptable vs a reverse IPC channel to safeStorage?
  Env is readable via `/proc`-like introspection on some OSes; on macOS a process's env is readable by
  the same user. Does that materially weaken it vs. the extension already being full-access?
- **Streaming backpressure** — is microtask-coalesce + byte-budget enough, or do we need explicit
  credit-based flow control for `adb logcat`-class firehoses?
- **Multi-instance storage race** — accept last-write-wins for v1, or is a file lock worth it now?
- **Data dir GC** — removed on uninstall; what about an extension that's disabled for months (keep)?

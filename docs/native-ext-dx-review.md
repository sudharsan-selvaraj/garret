# Native extension DX review — pain points from 4 raw extensions

We built four extensions against the bare bridge to find real friction before designing an SDK:

| Extension | Exercises | Files |
|---|---|---|
| file-explorer | `fs` + `fs.watch` events + resource lifecycle | `examples/native-file-explorer/` |
| command-runner | `spawn` + **live streaming** output + cancel | `examples/native-command-runner/` |
| system-monitor | **polling loop** + start/stop lifecycle + multi-channel events | `examples/native-system-monitor/` |
| quick-notes | **persistence** (where does state live?) | `examples/native-quick-notes/` |

## Pain points (ranked by how much they hurt)

### P1 — No streaming primitive *(the worst)*
A bridge call returns exactly once, but `spawn`, `adb logcat`, file `pull` progress, and log tails
produce output over time. command-runner fakes it: `start()` returns a hand-rolled `runId`, output
arrives as `output` events tagged with that id, and **the UI correlates every event by id itself**
and ignores stale runs (`command-runner/ui/index.html` `activeRun`). Every streaming extension
re-invents this exact dance. This is also the shape Device Control (Phase 4) needs for `adb`/`scrcpy`.

### P2 — Events are one untyped global firehose
`window.garret.native.onEvent((channel, payload) => …)` delivers *all* events; every UI hand-filters
`if (channel === 'stats')` and casts `payload` (`system-monitor`, `command-runner`, `file-explorer`
all do this). No per-channel subscribe, no payload types, no unsubscribe-per-channel.

### P3 — Stringly-typed methods, no types across the bridge
`request('topProcesses')` / `request('start', {cmd})` — a typo is a runtime `unknown method`, args
and return values are `any`, and there's zero autocomplete. The contract lives only in the author's
head, duplicated between `main.cjs` and the UI.

### P4 — Bridge boilerplate copy-pasted verbatim
The identical ~15-line block (`send()` + `parentPort.on('message')` dispatcher +
`send({t:'ready'})`) is pasted into **all four** `main.cjs`. Forget the `ready` line and every
request hangs forever (the host waits for it). Pure ceremony, one bug away from a silent hang.

### P5 — No lifecycle / dispose hook
Intervals (system-monitor), `fs.watch` handles (file-explorer), and child processes
(command-runner) must be torn down by hand. There's no `onDispose`, so: double-`start()` leaks a
timer unless the author guards it (system-monitor does, file-explorer does for the watcher), and if
the UI unmounts, the host process is killed but any in-flight children are orphaned unless the
author tracked them. The UI side has no unmount hook either, so `stop()` is easy to forget.

### P6 — No storage, no per-extension data dir
quick-notes has to invent `~/.garret-quick-notes/notes.json`: it litters `$HOME`, isn't cleaned up
on uninstall, is a **racy read-modify-write across placed instances**, non-atomic (crash mid-write
corrupts it), and would be **plaintext for secrets** even though the host already has a safeStorage
vault. The platform gives raw Node but no "here's your namespaced, atomic, per-extension store."

### P7 — Errors are just strings; binary discovery UX is on the author
`spawn` ENOENT (binary missing) flattens to `String(err.message)`; the UI can't tell "not found"
from "crashed," and there's no "install adb: `brew install …`" affordance. PATH is injected, but
finding/validating a binary and giving good UX is left to each author.

### P9 — Sibling methods can't call each other *(silent footgun — cost us a real bug)*
Methods live as properties of a `methods` object, so calling a sibling as a bare identifier
(`stop()` from inside `start()`) throws `ReferenceError: stop is not defined` — caught by the
bridge, returned as an error the UI usually doesn't surface, so the feature just silently doesn't
work. This actually bit system-monitor (`stop is not defined` → the poll never started → "stats
starting…" forever). Authors must extract standalone helpers or write `methods.stop()`. **SDK:**
`defineHost` should give each method access to the others (e.g. via a bound `this`/`ctx.methods`),
or the toolkit-first style (`ctx.spawn` etc.) sidesteps most cross-calls.

Also confirmed: **host errors were invisible** — the utilityProcess's stderr wasn't piped and a
crash-before-`ready` hung every request forever with no timeout. Fixed in `extensionHost.ts` (pipe
stdio with an `[ext:<id>]` prefix; reject `ready` on early exit + a startup grace timeout). The SDK
inherits this; authors get real error output instead of a spinner.

### P10 — Inline UI scripts run in the global scope → silent redeclaration of injected/window globals
The UI is a plain HTML page, so its `<script>` runs in the page's **global** scope. The confirmed
instance (a full debug session): file-explorer did `const garret = window.garret && window.garret.native`
— but the preload exposes a **non-configurable global `garret`** via `contextBridge`, so a top-level
`const garret` *redeclares* it → `Uncaught SyntaxError: Identifier 'garret' has already been declared`
at evaluation → the **entire script aborts before line 1** → the widget shows its static HTML
("Loading…") and does nothing, no error surfaced in the widget itself. The other three examples
named their local `g`, so only this one broke; and `new Function(src)`/a plain browser miss it
(function scope; no injected global). The same trap applies to `window.parent`/`top`/`self`/`name`.
**SDK:** a bundled, module-scoped UI (`ui/App.tsx` → esbuild/vite) has its own scope, imports the
client explicitly (`const gx = useHost()`), and never redeclares a global — this class of bug can't
happen. The strongest concrete argument for the build-step SDK over hand-written inline HTML.

Tooling gap this exposed: native webview errors were only visible after we added **dev
auto-open-DevTools for `garret-native://` webviews** (`src/main/index.ts`). Extension authors need
that from day one — the SDK/scaffold should make the UI's console trivially inspectable.

### P8 — Manual arg-guarding + naive parsing
Every method opens with `({ x } = {})` and validates by hand; command-runner splits the command on
whitespace (breaks quotes/globs). Papercuts, but universal.

## What an SDK should provide (mapping)

| Pain | SDK feature |
|---|---|
| P1 streaming | first-class stream primitive: host method yields chunks; UI gets `.onData/.onEnd/.cancel()` (or an async iterator). SDK owns runId + correlation + teardown. |
| P2 events | typed per-channel `host.on('stats', p => …)` with payload types from a shared interface; auto-unsubscribe. |
| P3 types | one shared `Api`/`Events` interface; `defineHost<Api,Events>()` + `createClient<Api,Events>()` → typed calls, autocomplete, compile-time method checks. |
| P4 boilerplate | `defineHost(methods)` hides the envelope + sends `ready` automatically. |
| P5 lifecycle | `ctx.onDispose(cb)`; SDK auto-tracks spawned children/timers/streams and tears them down; React `useHost()` disposes on unmount. |
| P6 storage | `ctx.storage` (namespaced, atomic) + `ctx.secrets` (safeStorage) + a real per-extension data dir removed on uninstall. |
| P7 errors | structured errors across the bridge + `ctx.resolveBinary('adb')` with install hints. |
| P8 args | typed args (from P3) + a `ctx.spawn` helper that arg-splits safely. |

## Proposed `garret-ext` shape (for review)

```ts
// shared/api.ts — the one contract both sides import
export interface Api { start(a: { cmd: string }): { runId: string }; kill(a: { runId: string }): void }
export interface Events { stats: { load: number[] } }

// host/index.ts
export default defineHost<Api, Events>((ctx) => ({
  start: ({ cmd }) => ctx.stream(async (out) => {           // P1: return a stream
    const child = ctx.spawn(cmd)                            // P7/P8: safe spawn + PATH
    child.stdout.on('data', (d) => out.push(d.toString()))
    ctx.onDispose(() => child.kill())                       // P5: auto-teardown
  }),
}))

// ui/App.tsx (React)
const host = useHost<Api, Events>()                         // P3/P4: typed, no boilerplate
const run = host.start({ cmd })                             // P1: streaming handle
useEffect(() => run.onData(appendLine).onEnd(markDone), [])
useHostEvent('stats', (p) => setLoad(p.load))               // P2: typed per-channel
```

Two runtime worlds stay two worlds (the UI still can't `import fs`) — that boundary is the security
line. The SDK just makes crossing it typed, streamable, and boilerplate-free.

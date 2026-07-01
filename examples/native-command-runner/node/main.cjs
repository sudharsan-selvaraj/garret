// Command Runner — NODE side. Spawns a process and STREAMS its stdout/stderr back.
//
// This is where the request/response bridge hurts: a call can only return ONCE, but a command
// produces output over time. So we fake streaming by hand — return a `runId`, then fire `output`
// events tagged with that id, and the UI has to correlate them itself. Every streaming extension
// re-invents this.

const { spawn } = require('child_process')

const runs = new Map() // runId -> child process (so `kill` can find it)

const methods = {
  /** Start a command. Returns a runId immediately; output arrives later as events. */
  start({ cmd } = {}) {
    if (!cmd || !cmd.trim()) throw new Error('empty command')
    const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}` // hand-rolled id
    const parts = cmd.trim().split(/\s+/) // naive arg-splitting (no quotes/globs — also a papercut)
    let child
    try {
      child = spawn(parts[0], parts.slice(1), { env: process.env })
    } catch (err) {
      // spawn can throw synchronously; the UI only gets a string.
      throw new Error(`could not start: ${err.message}`)
    }
    runs.set(runId, child)

    child.stdout.on('data', (d) =>
      send({ t: 'event', channel: 'output', payload: { runId, stream: 'stdout', chunk: d.toString() } })
    )
    child.stderr.on('data', (d) =>
      send({ t: 'event', channel: 'output', payload: { runId, stream: 'stderr', chunk: d.toString() } })
    )
    // 'error' fires for ENOENT (binary not found) — the author must translate to nice UX.
    child.on('error', (e) => {
      runs.delete(runId)
      send({ t: 'event', channel: 'exit', payload: { runId, error: e.message } })
    })
    child.on('close', (code) => {
      runs.delete(runId)
      send({ t: 'event', channel: 'exit', payload: { runId, code } })
    })
    return { runId }
  },

  /** Cancel a running command. */
  kill({ runId } = {}) {
    const child = runs.get(runId)
    if (child) child.kill()
    return { killed: Boolean(child) }
  }
}

// ── bridge plumbing — copy-pasted verbatim from every other extension ───────────────────────────
function send(msg) {
  process.parentPort.postMessage(msg)
}
process.parentPort.on('message', (e) => {
  const msg = e.data
  if (!msg || msg.t !== 'req') return
  const fn = methods[msg.method]
  if (!fn) return send({ t: 'res', id: msg.id, ok: false, error: `unknown method: ${msg.method}` })
  Promise.resolve()
    .then(() => fn(msg.args))
    .then((value) => send({ t: 'res', id: msg.id, ok: true, value }))
    .catch((err) => send({ t: 'res', id: msg.id, ok: false, error: String(err?.message ?? err) }))
})
send({ t: 'ready' })
// NOTE: if the host is killed mid-run, children are orphaned unless we track + kill them on exit.
// There's no lifecycle/dispose hook, so cleanup is on us — and easy to forget.

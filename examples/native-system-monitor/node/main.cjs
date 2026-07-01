// System Monitor — NODE side. Polls system stats on a timer and pushes them as events.
//
// Surfaces the "long-lived background work" pain: the UI has to explicitly start() and stop() the
// poll, the interval is process-global state the author juggles, and if the UI forgets to stop()
// (or just unmounts), the timer keeps running until the host is killed. No lifecycle hook.

const os = require('os')
const { exec } = require('child_process')

let timer = null

const methods = {
  /** Begin polling. The UI must remember to call stop() — nothing does it automatically. */
  start({ intervalMs = 2000 } = {}) {
    stop() // guard against double-start leaking a timer (easy to forget)
    const tick = () => {
      send({
        t: 'event',
        channel: 'stats',
        payload: {
          load: os.loadavg(), // [1m, 5m, 15m]
          cpus: os.cpus().length,
          memTotal: os.totalmem(),
          memFree: os.freemem(),
          at: Date.now()
        }
      })
    }
    tick()
    timer = setInterval(tick, intervalMs)
    return { started: true }
  },

  stop() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    return { stopped: true }
  },

  /** One-off: top processes by CPU. Async spawn (vs. the tempting-but-blocking execSync). */
  topProcesses() {
    return new Promise((resolve, reject) => {
      exec('ps -Ao pid,pcpu,pmem,comm -r', { maxBuffer: 1 << 20 }, (err, stdout) => {
        if (err) return reject(new Error(err.message))
        const rows = stdout
          .trim()
          .split('\n')
          .slice(1, 9)
          .map((l) => {
            const [pid, cpu, mem, ...comm] = l.trim().split(/\s+/)
            return { pid, cpu, mem, comm: comm.join(' ') }
          })
        resolve({ rows })
      })
    })
  }
}

// ── bridge plumbing — copy-pasted verbatim (again) ──────────────────────────────────────────────
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

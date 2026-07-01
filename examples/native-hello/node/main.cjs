// Node side of the "Hello (native)" extension — runs in a utilityProcess with RAW NODE.
// Speaks Garret's native bridge: responds to { t:'req', id, method, args } with
// { t:'res', id, ok, value } and may emit { t:'event', channel, payload }.
const os = require('os')
const { execSync } = require('child_process')

const methods = {
  info() {
    let whoami = ''
    try {
      whoami = execSync('whoami').toString().trim()
    } catch {
      /* ignore */
    }
    return {
      node: process.version,
      hostname: os.hostname(),
      platform: `${os.platform()} ${os.release()}`,
      whoami,
      uptimeMin: Math.round(os.uptime() / 60),
      pid: process.pid
    }
  }
}

process.parentPort.on('message', (e) => {
  const msg = e.data
  if (!msg || msg.t !== 'req') return
  const fn = methods[msg.method]
  if (!fn) {
    process.parentPort.postMessage({ t: 'res', id: msg.id, ok: false, error: `unknown method: ${msg.method}` })
    return
  }
  Promise.resolve()
    .then(() => fn(msg.args))
    .then((value) => process.parentPort.postMessage({ t: 'res', id: msg.id, ok: true, value }))
    .catch((err) =>
      process.parentPort.postMessage({ t: 'res', id: msg.id, ok: false, error: String(err?.message ?? err) })
    )
})

// Announce readiness, then tick a live "uptime" event every 5s to exercise events.
process.parentPort.postMessage({ t: 'ready' })
setInterval(() => {
  process.parentPort.postMessage({ t: 'event', channel: 'tick', payload: { at: Date.now() } })
}, 5000)

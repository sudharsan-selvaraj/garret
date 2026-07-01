// Quick Notes — NODE side. Persists a little JSON.
//
// Surfaces the "where does my state go?" pain. The bridge gives me raw Node but NO storage helper
// and NO per-extension data directory. So I improvise: a dotfolder in $HOME. That means:
//   - I litter the user's home dir (and nothing cleans it up when the extension is removed).
//   - Two placed instances of this widget race on the same file (read-modify-write, no atomicity).
//   - If these were secrets, they'd sit here in plaintext (no encrypted store like the host has).

const fs = require('fs')
const path = require('path')
const os = require('os')

const DIR = path.join(os.homedir(), '.garret-quick-notes') // arbitrary — my choice, not the platform's
const FILE = path.join(DIR, 'notes.json')

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'))
  } catch {
    return []
  }
}
function save(notes) {
  fs.mkdirSync(DIR, { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify(notes)) // not atomic; a crash mid-write corrupts it
}

const methods = {
  all() {
    return { notes: load() }
  },
  add({ text } = {}) {
    if (!text || !text.trim()) throw new Error('empty note')
    const notes = load() // read-modify-write — racy across instances
    notes.unshift({ id: Date.now(), text: text.trim() })
    save(notes)
    return { notes }
  },
  remove({ id } = {}) {
    const notes = load().filter((n) => n.id !== id)
    save(notes)
    return { notes }
  }
}

// ── bridge plumbing — copy-pasted verbatim (a third time) ───────────────────────────────────────
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

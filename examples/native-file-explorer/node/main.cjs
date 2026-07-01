// File Explorer — the NODE side of the extension.
//
// This runs in a utilityProcess with RAW NODE: `require` anything (Node builtins, or npm deps you
// bundle into the extension), spawn processes, open sockets — full system access. There is no
// permission gate; you brought all the logic, Garret just runs it.
//
// You talk to your UI over Garret's tiny bridge. You implement METHODS the UI can call, and you
// can push EVENTS to the UI at any time. The envelope:
//     UI  → you:  { t:'req',   id, method, args }
//     you → UI :  { t:'res',   id, ok, value }   or   { t:'res', id, ok:false, error }
//     you → UI :  { t:'event', channel, payload }        (unsolicited, e.g. a fs watcher firing)

const fsp = require('fs/promises')
const fs = require('fs')
const path = require('path')
const os = require('os')

const MAX_PREVIEW = 256 * 1024 // don't slurp huge files into the preview pane

// ── the methods your UI can call via window.garret.native.request('<name>', args) ──────────────
const methods = {
  /** Where to start. */
  home() {
    return { path: os.homedir() }
  },

  /** List a directory. Returns folders-first, with size + mtime. Raw `fs`, nothing else. */
  async list({ dir } = {}) {
    const target = dir || os.homedir()
    const dirents = await fsp.readdir(target, { withFileTypes: true })
    const items = await Promise.all(
      dirents.map(async (d) => {
        const full = path.join(target, d.name)
        let size = 0
        let mtime = 0
        try {
          const st = await fsp.stat(full) // may throw on perms / broken symlink — still list it
          size = st.size
          mtime = st.mtimeMs
        } catch {
          /* unreadable — leave zeros */
        }
        return { name: d.name, path: full, isDir: d.isDirectory(), size, mtime }
      })
    )
    items.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
    return { dir: target, parent: path.dirname(target), items }
  },

  /** Read a file for the preview pane (text only, size-capped). */
  async read({ path: p } = {}) {
    const st = await fsp.stat(p)
    if (st.size > MAX_PREVIEW) return { path: p, tooBig: true, size: st.size }
    const buf = await fsp.readFile(p)
    const binary = buf.subarray(0, 8000).includes(0) // crude NUL sniff
    return { path: p, tooBig: false, binary, text: binary ? '' : buf.toString('utf8') }
  },

  /** Start watching a directory; changes arrive as { t:'event', channel:'changed', payload }. */
  watch({ dir } = {}) {
    stopWatch()
    watcher = fs.watch(dir, { persistent: false }, () => {
      send({ t: 'event', channel: 'changed', payload: { dir } })
    })
    return { watching: dir }
  }
}

// ── bridge plumbing — identical in every extension (a future SDK could hide all of this) ────────
let watcher = null
function stopWatch() {
  if (watcher) {
    watcher.close()
    watcher = null
  }
}
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

send({ t: 'ready' }) // MUST announce ready — requests are queued until you do

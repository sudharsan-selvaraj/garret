// Clock widget. Reads its own settings (Settings → Clock & Timers → Clock) straight from the guest
// bridge: the preload auto-binds and exposes window.__garret.storage, which reads the same per-widget
// storage.json that the settings pane writes. No SDK bundle needed — a pure-UI widget stays vanilla.
const timeEl = document.getElementById('time')
const dateEl = document.getElementById('date')

const g = window.__garret
let settings = { format: '12-hour', showSeconds: true }

function tick() {
  const now = new Date()
  const opts = { hour: '2-digit', minute: '2-digit', hour12: settings.format !== '24-hour' }
  if (settings.showSeconds) opts.second = '2-digit'
  timeEl.textContent = now.toLocaleTimeString([], opts)
  dateEl.textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
}

// storage.get resolves to the stored value or undefined (no value set yet → keep the default).
async function refreshSettings() {
  if (!g?.storage) return
  try {
    const [format, showSeconds] = await Promise.all([
      g.storage.get('format'),
      g.storage.get('showSeconds')
    ])
    if (format === '12-hour' || format === '24-hour') settings.format = format
    if (typeof showSeconds === 'boolean') settings.showSeconds = showSeconds
    tick()
  } catch {
    /* not bound yet, or storage unavailable — keep current settings */
  }
}

tick()
setInterval(tick, 1000)

if (g) {
  // Read once bind resolves, then poll so edits in the settings pane show up without a reload,
  // and refresh whenever the board regains focus.
  g.onReady(() => void refreshSettings())
  g.onActiveChange((a) => a && void refreshSettings())
  setInterval(() => void refreshSettings(), 3000)
} else {
  void refreshSettings()
}

// Clock widget. Reads its own settings (Settings → Clock & Timers → Clock) straight from the guest
// bridge: the preload auto-binds and exposes window.__garret.storage, which reads the same per-widget
// storage.json that the settings pane writes. No SDK bundle needed — a pure-UI widget stays vanilla.
const timeEl = document.getElementById('time')
const dateEl = document.getElementById('date')
const hourEl = document.getElementById('h-hour')
const minEl = document.getElementById('h-min')
const secEl = document.getElementById('h-sec')
const ticksEl = document.getElementById('ticks')

const g = window.__garret
let settings = { face: 'analog', format: '12-hour', showSeconds: true }

// Build the 60-minute tick track once (hours — every 5th — are longer + brighter).
function buildTicks() {
  if (!ticksEl || ticksEl.childElementCount) return
  const NS = 'http://www.w3.org/2000/svg'
  for (let i = 0; i < 60; i++) {
    const hr = i % 5 === 0
    const a = (i * 6 * Math.PI) / 180
    const rIn = hr ? 39.5 : 42
    const rOut = 45
    const ln = document.createElementNS(NS, 'line')
    ln.setAttribute('x1', (50 + Math.sin(a) * rIn).toFixed(2))
    ln.setAttribute('y1', (50 - Math.cos(a) * rIn).toFixed(2))
    ln.setAttribute('x2', (50 + Math.sin(a) * rOut).toFixed(2))
    ln.setAttribute('y2', (50 - Math.cos(a) * rOut).toFixed(2))
    ln.setAttribute('class', hr ? 'tick hr' : 'tick')
    ticksEl.appendChild(ln)
  }
}

function tick() {
  const now = new Date()
  // Digital readout (shown large in digital mode, small under the analog face).
  const opts = { hour: '2-digit', minute: '2-digit', hour12: settings.format !== '24-hour' }
  if (settings.showSeconds) opts.second = '2-digit'
  timeEl.textContent = now.toLocaleTimeString([], opts)
  dateEl.textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })

  // Analog hands — rotate around the face centre (50,50). Only worth computing in analog mode.
  if (settings.face !== 'digital') {
    const s = now.getSeconds()
    const m = now.getMinutes() + s / 60
    const h = (now.getHours() % 12) + m / 60
    hourEl.setAttribute('transform', `rotate(${h * 30} 50 50)`)
    minEl.setAttribute('transform', `rotate(${m * 6} 50 50)`)
    secEl.setAttribute('transform', `rotate(${s * 6} 50 50)`)
  }
}

// Reflect settings on <body>: `analog` toggles the face vs. the big digital readout; `no-sec` hides
// the second hand when seconds are off.
function applyMode() {
  const analog = settings.face !== 'digital'
  document.body.classList.toggle('analog', analog)
  document.body.classList.toggle('no-sec', analog && !settings.showSeconds)
}

// storage.get resolves to the stored value or undefined (no value set yet → keep the default).
async function refreshSettings() {
  if (!g?.storage) return
  try {
    const [face, format, showSeconds] = await Promise.all([
      g.storage.get('face'),
      g.storage.get('format'),
      g.storage.get('showSeconds')
    ])
    if (face === 'analog' || face === 'digital') settings.face = face
    if (format === '12-hour' || format === '24-hour') settings.format = format
    if (typeof showSeconds === 'boolean') settings.showSeconds = showSeconds
    applyMode()
    tick()
  } catch {
    /* not bound yet, or storage unavailable — keep current settings */
  }
}

buildTicks()
applyMode()
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

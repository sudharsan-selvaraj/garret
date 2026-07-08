// A pure-UI widget: no host, no capabilities, no bind — just render the time. The simplest possible
// pack, and the first bundled one (proves the bundled-pack → auto-install → board-render path).
const timeEl = document.getElementById('time')
const dateEl = document.getElementById('date')

function tick() {
  const now = new Date()
  timeEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  dateEl.textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
}

tick()
setInterval(tick, 1000)

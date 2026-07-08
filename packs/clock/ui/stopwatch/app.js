// Stopwatch — counts up. Pure UI, per-widget origin. Tracks elapsed ms across pause/resume.
const timeEl = document.getElementById('time')
const startPauseEl = document.getElementById('startpause')
const resetEl = document.getElementById('reset')

let elapsed = 0 // ms accumulated before the current run
let startedAt = 0 // Date.now() when the current run began
let running = false
let handle = null

function total() {
  return elapsed + (running ? Date.now() - startedAt : 0)
}
function fmt(ms) {
  const t = Math.floor(ms / 100) // tenths
  const tenths = t % 10
  const s = Math.floor(t / 10)
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.${tenths}`
}
function paint() {
  timeEl.textContent = fmt(total())
  startPauseEl.textContent = running ? 'Pause' : elapsed > 0 ? 'Resume' : 'Start'
}

startPauseEl.addEventListener('click', () => {
  if (running) {
    elapsed = total()
    running = false
    clearInterval(handle)
    handle = null
  } else {
    running = true
    startedAt = Date.now()
    handle = setInterval(paint, 100)
  }
  paint()
})
resetEl.addEventListener('click', () => {
  running = false
  if (handle) clearInterval(handle)
  handle = null
  elapsed = 0
  paint()
})

paint()

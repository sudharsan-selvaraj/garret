// Countdown timer. Pure UI, per-widget origin (isolated). remaining = seconds left; running toggles.
const timeEl = document.getElementById('time')
const startPauseEl = document.getElementById('startpause')
const resetEl = document.getElementById('reset')

let remaining = 0 // seconds
let running = false
let handle = null
let lastTick = 0

function fmt(s) {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}
function paint() {
  timeEl.textContent = fmt(remaining)
  timeEl.classList.toggle('done', remaining === 0 && !running)
  startPauseEl.textContent = running ? 'Pause' : 'Start'
}
function stop() {
  running = false
  if (handle) clearInterval(handle)
  handle = null
}
function loop() {
  const now = Date.now()
  if (now - lastTick >= 1000) {
    lastTick = now
    remaining = Math.max(0, remaining - 1)
    if (remaining === 0) stop()
    paint()
  }
}

for (const b of document.querySelectorAll('.presets button')) {
  b.addEventListener('click', () => {
    stop()
    remaining = Number(b.dataset.min) * 60
    paint()
  })
}
startPauseEl.addEventListener('click', () => {
  if (running) {
    stop()
  } else if (remaining > 0) {
    running = true
    lastTick = Date.now()
    handle = setInterval(loop, 100)
  }
  paint()
})
resetEl.addEventListener('click', () => {
  stop()
  remaining = 0
  paint()
})

paint()

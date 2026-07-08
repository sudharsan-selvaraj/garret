// World clock — a few timezones, updated each second. Pure UI; per-widget origin so any state is
// isolated. (A settings schema could make the zone list configurable once the settings sidebar lands.)
const ZONES = [
  { city: 'Local', tz: undefined },
  { city: 'New York', tz: 'America/New_York' },
  { city: 'London', tz: 'Europe/London' },
  { city: 'Tokyo', tz: 'Asia/Tokyo' }
]

const rowsEl = document.getElementById('rows')
const timeEls = ZONES.map((z) => {
  const row = document.createElement('div')
  row.className = 'row'
  const left = document.createElement('div')
  const city = document.createElement('div')
  city.className = 'city'
  city.textContent = z.city
  const zone = document.createElement('div')
  zone.className = 'zone'
  zone.textContent = z.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  left.append(city, zone)
  const t = document.createElement('div')
  t.className = 't'
  row.append(left, t)
  rowsEl.append(row)
  return t
})

function tick() {
  const now = new Date()
  ZONES.forEach((z, i) => {
    timeEls[i].textContent = now.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: z.tz
    })
  })
}

tick()
setInterval(tick, 1000)

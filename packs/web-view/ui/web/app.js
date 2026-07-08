// Web View: an isolated <webview> onto an arbitrary https page. The URL bar navigates live; the
// Settings pane (Web View → Page URL) sets the home URL. Both persist to the same per-widget storage
// key `url`, so the widget reopens where it was left. Vanilla + strict-CSP (external app.js).
const g = window.__garret
const view = document.getElementById('view')
const input = document.getElementById('url')
const go = document.getElementById('go')

const HOME = 'https://example.com'
let current = HOME

// Accept "example.com" or a full URL; force https (main blocks non-https attaches/navigations anyway).
function normalize(raw) {
  const s = String(raw || '').trim()
  if (!s) return null
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`
  try {
    const u = new URL(withScheme)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    return u.href
  } catch {
    return null
  }
}

function navigate(raw, persist) {
  const url = normalize(raw)
  if (!url) return
  current = url
  input.value = url
  if (view.src !== url) view.src = url
  if (persist && g?.storage) void g.storage.set('url', url)
}

go.addEventListener('click', () => navigate(input.value, true))
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') navigate(input.value, true)
})
// Reflect in-page navigations (link clicks) back into the bar.
view.addEventListener('did-navigate', (e) => {
  if (e.url) {
    current = e.url
    input.value = e.url
  }
})

async function start() {
  let url = HOME
  if (g?.storage) {
    try {
      const saved = await g.storage.get('url')
      if (typeof saved === 'string' && saved) url = saved
    } catch {
      /* not bound yet — fall back to home */
    }
  }
  navigate(url, false)
}

input.value = current
if (g) g.onReady(() => void start())
else void start()

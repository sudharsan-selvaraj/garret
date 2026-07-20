import { app, BrowserWindow, ipcMain, WebContentsView } from 'electron'
import { Channels } from '@shared/ipc/channels'

/**
 * THROWAWAY SPIKE (dev-only, gated by GARRET_WCV_SPIKE=1) — measures the cost of driving a
 * `WebContentsView` from the renderer's layout, the open question in docs/guide/03-architecture.md §3
 * (renderer primitive: `<webview>` vs `WebContentsView`).
 *
 * A `WebContentsView` is NOT a DOM node — it's an OS layer attached to the window in main and
 * positioned by absolute pixel `setBounds` in window-content coordinates. This spike lets a
 * renderer tile report its on-screen rect (getBoundingClientRect) on every drag/resize/scroll
 * frame; we push it straight to `setBounds` with NO throttle/hide, so we're measuring the WORST
 * case. If tracking is smooth, geometry management is cheap; if it lags, hide-on-interaction is
 * the mitigation. Delete this whole folder + its channels once the decision is made.
 */

const views = new Map<string, WebContentsView>()

function board(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null
}

// A deliberately garish test page: a 3px border + a diagonal gradient + a live size/position
// readout + its own scrollable strip, so ANY drift from the placeholder rect is obvious, and so
// we can confirm the view scrolls its OWN content independently of the board.
const TEST_PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;font:12px -apple-system,sans-serif;color:#fff;overflow:hidden}
  body{background:linear-gradient(135deg,#0a84ff,#bf5af2);border:3px solid #30d158;box-sizing:border-box;
       display:flex;flex-direction:column}
  .hdr{padding:8px 10px;font-weight:700;letter-spacing:.02em;text-shadow:0 1px 2px rgba(0,0,0,.4)}
  .meta{padding:0 10px;font-variant-numeric:tabular-nums;opacity:.9}
  .scroll{flex:1;overflow:auto;margin:8px;background:rgba(0,0,0,.25);border-radius:8px;padding:10px}
  .scroll div{padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.15)}
</style></head><body>
  <div class="hdr">◆ WebContentsView SPIKE</div>
  <div class="meta" id="m">…</div>
  <div class="scroll" id="s"></div>
  <script>
    const s=document.getElementById('s');
    for(let i=0;i<40;i++){const d=document.createElement('div');d.textContent='inner row '+i+' — this view scrolls independently';s.appendChild(d)}
    const m=document.getElementById('m');
    function tick(){ m.textContent = Math.round(innerWidth)+' × '+Math.round(innerHeight)+' px'; }
    tick(); addEventListener('resize', tick);
  </script>
</body></html>`

export function registerWcvSpike(): void {
  const enabled = !app.isPackaged && process.env.GARRET_WCV_SPIKE === '1'
  ipcMain.handle(Channels.wcvSpikeEnabled, () => enabled)
  if (!enabled) return

  ipcMain.handle(Channels.wcvSpikeCreate, (_e, id: string) => {
    const win = board()
    if (!win || views.has(id)) return
    const view = new WebContentsView({ webPreferences: { transparent: true } })
    view.setBackgroundColor('#00000000')
    win.contentView.addChildView(view)
    void view.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(TEST_PAGE))
    views.set(id, view)
  })

  ipcMain.handle(
    Channels.wcvSpikeBounds,
    (_e, id: string, r: { x: number; y: number; width: number; height: number }) => {
      views.get(id)?.setBounds({
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height)
      })
    }
  )

  ipcMain.handle(Channels.wcvSpikeVisible, (_e, id: string, visible: boolean) => {
    views.get(id)?.setVisible(visible)
  })

  ipcMain.handle(Channels.wcvSpikeDestroy, (_e, id: string) => {
    const view = views.get(id)
    if (!view) return
    board()?.contentView.removeChildView(view)
    view.webContents.close()
    views.delete(id)
  })

  console.error('[wcv-spike] enabled — add the spike tile from the board (dev)')
}

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

export interface ExternalWidgetSource {
  name: string
  source: string
}

/**
 * Dev-tier external widgets: plain `.js` files dropped in `external-widgets/` at
 * the project root. The renderer executes each against a global `garret` runtime
 * (trusted — full SDK access). The sandboxed/permissioned community path comes later.
 */
function widgetsDir(): string {
  return join(process.cwd(), 'external-widgets')
}

export function listExternalWidgets(): ExternalWidgetSource[] {
  // Trusted/dev tier only: it relies on `new Function` (no CSP). Packaged builds
  // load nothing here so production can keep a strict CSP. The sandbox tier
  // (see BACKLOG.md) is what enables distributed widgets in packaged apps.
  if (app.isPackaged) return []
  const dir = widgetsDir()
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.js'))
      .map((f) => ({ name: f, source: readFileSync(join(dir, f), 'utf8') }))
  } catch (err) {
    console.warn('[plugins] failed to read external widgets', err)
    return []
  }
}

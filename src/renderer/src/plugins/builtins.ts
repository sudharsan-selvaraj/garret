import type { AnyWidgetPlugin } from '@sdk'
import { registry } from '@renderer/plugins/registry'
import gitRepo from '@plugins/git-repo'
import notes from '@plugins/notes'
import weather from '@plugins/weather'
import devTools from '@plugins/dev-tools'
import snippets from '@plugins/snippets'
import calendar from '@plugins/calendar'

/**
 * The single touchpoint for shipping a new built-in widget: add it here.
 * (Everything else about a widget lives in its own module under src/plugins.)
 */
const builtins: AnyWidgetPlugin[] = [calendar, gitRepo, weather, notes, devTools, snippets]

let done = false
export function registerBuiltins(): void {
  if (done) return
  registry.registerAll(builtins)
  done = true
}

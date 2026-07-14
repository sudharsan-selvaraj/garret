import type { AnyWidgetPlugin } from '@sdk'
import { registry } from '@renderer/plugins/registry'
import gitRepo from '@plugins/git-repo'

/**
 * The single touchpoint for shipping a new built-in widget: add it here.
 * (Everything else about a widget lives in its own module under src/plugins.)
 */
const builtins: AnyWidgetPlugin[] = [gitRepo]

let done = false
export function registerBuiltins(): void {
  if (done) return
  registry.registerAll(builtins)
  done = true
}

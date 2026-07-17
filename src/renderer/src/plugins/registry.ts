import type { AnyWidgetPlugin } from '@renderer/plugins/types'

/**
 * The plugin registry. Core code only knows about this — it never imports a
 * specific widget. Plugins self-register here at startup (see builtins.ts).
 */
class PluginRegistry {
  private readonly plugins = new Map<string, AnyWidgetPlugin>()

  register(plugin: AnyWidgetPlugin): void {
    if (this.plugins.has(plugin.manifest.id)) {
      console.warn(`[registry] duplicate plugin id "${plugin.manifest.id}" ignored`)
      return
    }
    this.plugins.set(plugin.manifest.id, plugin)
  }

  registerAll(plugins: AnyWidgetPlugin[]): void {
    plugins.forEach((p) => this.register(p))
  }

  /** Remove a plugin (used when a sandboxed widget is uninstalled/disabled/re-synced). */
  unregister(id: string): void {
    this.plugins.delete(id)
  }

  get(id: string): AnyWidgetPlugin | undefined {
    return this.plugins.get(id)
  }

  list(): AnyWidgetPlugin[] {
    return [...this.plugins.values()]
  }
}

export const registry = new PluginRegistry()

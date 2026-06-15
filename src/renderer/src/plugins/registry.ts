import type { AnyWidgetPlugin } from '@sdk'

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

  get(id: string): AnyWidgetPlugin | undefined {
    return this.plugins.get(id)
  }

  list(): AnyWidgetPlugin[] {
    return [...this.plugins.values()]
  }
}

export const registry = new PluginRegistry()

import { Globe } from 'lucide-react'
import {
  defineWidget,
  field,
  type ConfigSchema,
  type WidgetManifest,
  type WidgetIconType
} from '@sdk'
import { WebView } from './WebView'

interface WebEmbedConfig {
  url: string
}

/** The generic "embed any URL" widget. */
const webEmbed = defineWidget<WebEmbedConfig>({
  manifest: {
    id: 'web-embed',
    name: 'Web Page',
    icon: Globe,
    description: 'Embed any web page by URL.',
    defaultSize: { w: 4, h: 6 },
    minSize: { w: 2, h: 3 },
    configSchema: {
      url: field.url({ label: 'Page URL', required: true, placeholder: 'https://…' })
    },
    capabilities: { refreshable: true }
  },
  render: ({ config, ctx }) => (
    <WebView
      src={config.url}
      partition={`persist:${ctx.instanceId}`}
      refreshToken={ctx.refreshToken}
    />
  )
})

export default webEmbed

/** ---- Factory: build a specialized web-embed widget in a few declarative lines. ---- */
interface WebEmbedDef<C> {
  id: string
  name: string
  icon?: WidgetIconType
  description?: string
  defaultSize?: { w: number; h: number }
  minSize?: { w: number; h: number }
  /** Config fields shown in the auto-generated settings form. */
  config?: ConfigSchema
  /** Compute the URL to embed from the instance config. */
  src: (config: C) => string
}

export function defineWebEmbedWidget<C = Record<string, unknown>>(def: WebEmbedDef<C>) {
  const manifest: WidgetManifest = {
    id: def.id,
    name: def.name,
    icon: def.icon,
    description: def.description,
    defaultSize: def.defaultSize ?? { w: 4, h: 6 },
    minSize: def.minSize ?? { w: 2, h: 3 },
    configSchema: def.config ?? {},
    capabilities: { refreshable: true }
  }

  return defineWidget<C>({
    manifest,
    render: ({ config, ctx }) => (
      <WebView
        src={def.src(config)}
        partition={`persist:${ctx.instanceId}`}
        refreshToken={ctx.refreshToken}
      />
    )
  })
}

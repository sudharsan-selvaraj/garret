import { useEffect, useState } from 'react'
import { Clock } from 'lucide-react'
import { defineWidget, field, type WidgetRenderProps } from '@sdk'

interface Config {
  format: string
  showSeconds: boolean
}

function ClockWidget({ config }: WidgetRenderProps<Config>): JSX.Element {
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const time = now.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: config.showSeconds ? '2-digit' : undefined,
    hour12: config.format !== '24h'
  })
  const date = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <div className="native-widget clock-widget">
      <div className="clock-time">{time}</div>
      <div className="clock-date">{date}</div>
    </div>
  )
}

export default defineWidget<Config>({
  manifest: {
    id: 'clock',
    name: 'Clock',
    icon: Clock,
    description: 'A simple clock and date.',
    defaultSize: { w: 3, h: 3 },
    minSize: { w: 2, h: 2 },
    capabilities: { headless: true },
    configSchema: {
      format: field.select({
        label: 'Time format',
        default: '12h',
        options: [
          { label: '12-hour', value: '12h' },
          { label: '24-hour', value: '24h' }
        ]
      }),
      showSeconds: field.boolean({ label: 'Show seconds', default: false })
    }
  },
  render: ClockWidget
})

import { useEffect, useState } from 'react'
import { CloudSun } from 'lucide-react'
import { defineWidget, field, type WidgetRenderProps } from '@sdk'

interface Config {
  city: string
}

interface Weather {
  place: string
  tempC: number
  code: number
}

// Minimal WMO weather-code → {emoji, label} mapping.
function describe(code: number): { icon: string; label: string } {
  if (code === 0) return { icon: '☀️', label: 'Clear' }
  if (code <= 2) return { icon: '🌤️', label: 'Partly cloudy' }
  if (code === 3) return { icon: '☁️', label: 'Overcast' }
  if (code <= 48) return { icon: '🌫️', label: 'Fog' }
  if (code <= 67) return { icon: '🌧️', label: 'Rain' }
  if (code <= 77) return { icon: '🌨️', label: 'Snow' }
  if (code <= 82) return { icon: '🌦️', label: 'Showers' }
  if (code <= 99) return { icon: '⛈️', label: 'Thunderstorm' }
  return { icon: '🌡️', label: 'Unknown' }
}

async function fetchWeather(city: string): Promise<Weather> {
  const geo = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`
  ).then((r) => r.json())
  const hit = geo?.results?.[0]
  if (!hit) throw new Error(`Couldn't find “${city}”`)

  const wx = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${hit.latitude}&longitude=${hit.longitude}&current=temperature_2m,weather_code`
  ).then((r) => r.json())

  return {
    place: [hit.name, hit.country_code].filter(Boolean).join(', '),
    tempC: Math.round(wx.current.temperature_2m),
    code: wx.current.weather_code
  }
}

function WeatherWidget({ config, ctx }: WidgetRenderProps<Config>): JSX.Element {
  const [data, setData] = useState<Weather | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!config.city) {
      setData(null)
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchWeather(config.city)
      .then((w) => !cancelled && setData(w))
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [config.city, ctx.refreshToken])

  if (!config.city) {
    return <div className="native-widget widget-placeholder">Open ⚙ and set a city.</div>
  }
  if (loading && !data) {
    return <div className="native-widget weather-widget">Loading…</div>
  }
  if (error) {
    return <div className="native-widget weather-widget weather-error">{error}</div>
  }
  if (!data) return <div className="native-widget weather-widget" />

  const { icon, label } = describe(data.code)
  return (
    <div className="native-widget weather-widget">
      <div className="weather-icon">{icon}</div>
      <div className="weather-temp">{data.tempC}°C</div>
      <div className="weather-label">{label}</div>
      <div className="weather-place">{data.place}</div>
    </div>
  )
}

export default defineWidget<Config>({
  manifest: {
    id: 'weather',
    name: 'Weather',
    icon: CloudSun,
    description: 'Current conditions for a city (Open-Meteo).',
    defaultSize: { w: 3, h: 4 },
    minSize: { w: 2, h: 3 },
    configSchema: {
      city: field.text({ label: 'City', required: true, placeholder: 'e.g. Bengaluru' })
    },
    capabilities: { refreshable: true }
  },
  render: WeatherWidget
})

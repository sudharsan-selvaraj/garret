import { Calendar as CalendarIcon, Video } from 'lucide-react'
import {
  defineWidget,
  field,
  openExternal,
  usePolledQuery,
  type WidgetRenderProps
} from '@sdk'
import type { CalendarEvent } from '@shared/types/calendar'

interface Config {
  title?: string
  range: string
  maxResults: number | string
  refreshMin: string
}

const SERVICE = 'google'

function calQuery(c: Config): { method: string; params: Record<string, unknown> } {
  return {
    method: 'listUpcomingEvents',
    params: { range: c.range || 'today', maxResults: Number(c.maxResults) || 12 }
  }
}

function intervalFor(c: Config): number {
  const m = Number(c.refreshMin)
  return m > 0 ? m * 60_000 : 15 * 60_000
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** Friendly day label for grouping separators. */
function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

function CalendarWidget({ config, ctx }: WidgetRenderProps<Config>): JSX.Element {
  const q = calQuery(config)
  const { data, error, loading } = usePolledQuery<CalendarEvent[]>(SERVICE, q.method, q.params, {
    intervalMs: intervalFor(config),
    refreshToken: ctx.refreshToken
  })

  if (error) {
    const notConnected = /not connected|reconnect|expired/i.test(error)
    return (
      <div className="svc-empty">
        {notConnected ? 'Connect Google in ⚙ settings to see your calendar.' : error}
      </div>
    )
  }
  if (!data && loading) return <div className="svc-empty">Loading…</div>
  const events = data ?? []
  if (events.length === 0) return <div className="svc-empty">No upcoming events.</div>

  const now = Date.now()
  const multiDay = (config.range || 'today') === 'week'
  // The next event that hasn't started yet — highlighted as the focus.
  const nextId = events.find((e) => !e.allDay && new Date(e.start).getTime() > now)?.id

  let lastDay = ''
  return (
    <div className="native-widget calendar">
      {events.map((e) => {
        const startMs = new Date(e.start).getTime()
        const endMs = e.end ? new Date(e.end).getTime() : startMs
        const ongoing = !e.allDay && startMs <= now && endMs > now
        const isNext = e.id === nextId
        const day = dayLabel(e.start)
        const showSep = multiDay && day !== lastDay
        lastDay = day

        return (
          <div key={e.id}>
            {showSep && <div className="cal-day">{day}</div>}
            <div className={`cal-event${ongoing ? ' ongoing' : ''}${isNext ? ' next' : ''}`}>
              <span className="cal-time">
                {ongoing ? 'NOW' : e.allDay ? 'all-day' : fmtTime(e.start)}
              </span>
              <button
                className="cal-main"
                title={e.title}
                onClick={() => e.url && openExternal(e.url)}
              >
                <span className="cal-title">{e.title}</span>
                {e.location && !e.joinUrl && <span className="cal-loc">{e.location}</span>}
              </button>
              {e.joinUrl && (
                <button
                  className="cal-join"
                  title="Join"
                  onClick={() => openExternal(e.joinUrl as string)}
                >
                  <Video size={12} strokeWidth={2} />
                  Join
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default defineWidget<Config>({
  manifest: {
    id: 'calendar',
    name: 'Calendar',
    icon: CalendarIcon,
    serviceId: 'google',
    description: 'Upcoming Google Calendar events, with one-click join.',
    defaultSize: { w: 4, h: 5 },
    minSize: { w: 3, h: 3 },
    capabilities: { refreshable: true },
    poll: (c: Config) => calQuery(c),
    configSchema: {
      title: field.text({ label: 'Title' }),
      range: field.select({
        label: 'Show',
        default: 'today',
        options: [
          { label: 'Today', value: 'today' },
          { label: 'Next 24 hours', value: 'day' },
          { label: 'Next 7 days', value: 'week' }
        ]
      }),
      maxResults: field.number({ label: 'Max events', default: 12 }),
      refreshMin: field.select({
        label: 'Refresh every',
        default: '15',
        options: [
          { label: 'Manual', value: '0' },
          { label: '5 min', value: '5' },
          { label: '15 min', value: '15' },
          { label: '30 min', value: '30' }
        ]
      })
    }
  },
  render: CalendarWidget
})

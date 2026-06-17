import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Users,
  Video,
  X
} from 'lucide-react'
import {
  defineWidget,
  field,
  openExternal,
  usePolledQuery,
  WidgetStatus,
  type WidgetRenderProps
} from '@sdk'
import type { Attendee, CalendarEvent, RsvpStatus } from '@shared/types/calendar'

interface Config {
  title?: string
  view: string
  range: string
  maxResults: number | string
  refreshMin: string
}

const SERVICE = 'google'

function intervalFor(c: Config): number {
  const m = Number(c.refreshMin)
  return m > 0 ? m * 60_000 : 24 * 60 * 60_000 // 0 = manual
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

const RSVP_LABEL: Record<RsvpStatus, string> = {
  accepted: 'Yes',
  declined: 'No',
  tentative: 'Maybe',
  needsAction: 'No reply'
}
const RSVP_ORDER: Record<RsvpStatus, number> = {
  accepted: 0,
  tentative: 1,
  needsAction: 2,
  declined: 3
}

function prettyName(name?: string, email?: string, self?: boolean): string {
  if (self) return 'You'
  if (name && name.trim()) return name.trim()
  const local = email?.split('@')[0] ?? ''
  if (!local) return email ?? 'Unknown'
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
}
function attendeeName(a: Attendee): string {
  return prettyName(a.name, a.email, a.self)
}
function sortAttendees(list: Attendee[]): Attendee[] {
  return [...list].sort((a, b) => {
    if (!!a.self !== !!b.self) return a.self ? -1 : 1
    if (!!a.organizer !== !!b.organizer) return a.organizer ? -1 : 1
    const r = RSVP_ORDER[a.response ?? 'needsAction'] - RSVP_ORDER[b.response ?? 'needsAction']
    if (r !== 0) return r
    return attendeeName(a).localeCompare(attendeeName(b))
  })
}
function durationLabel(startIso: string, endIso?: string): string {
  if (!endIso) return ''
  const mins = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000)
  if (mins <= 0) return ''
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h}h${m}` : `${h}h`
}
function timeRange(e: CalendarEvent): string {
  if (e.allDay) return 'All day'
  const start = fmtTime(e.start)
  const end = e.end ? fmtTime(e.end) : ''
  const dur = durationLabel(e.start, e.end)
  return `${start}${end ? `–${end}` : ''}${dur ? ` · ${dur}` : ''}`
}

/** Label for the agenda row's time column. */
function eventTimeLabel(e: CalendarEvent, ongoing: boolean): string {
  if (ongoing) return 'NOW'
  if (e.allDay) return 'all-day'
  return fmtTime(e.start)
}

/* ---------------- Shared event detail ---------------- */

function EventDetail({ e }: { e: CalendarEvent }): JSX.Element {
  const attendees = sortAttendees(e.attendees ?? [])
  const counts = attendees.reduce<Record<string, number>>((m, a) => {
    const k = a.response ?? 'needsAction'
    m[k] = (m[k] ?? 0) + 1
    return m
  }, {})
  const organizer = e.organizer

  return (
    <div className="cal-detail">
      <div className="cal-when">{timeRange(e)}</div>

      {attendees.length > 0 && (
        <div className="cal-counts">
          <Users size={12} strokeWidth={2} />
          <span className="cal-count-total">{attendees.length}</span>
          {(['accepted', 'declined', 'tentative', 'needsAction'] as RsvpStatus[])
            .filter((s) => counts[s])
            .map((s) => (
              <span key={s} className={`cal-count rsvp-${s}`}>
                <span className="rsvp-dot" />
                {counts[s]} {RSVP_LABEL[s]}
              </span>
            ))}
        </div>
      )}

      {organizer && (
        <div className="cal-organizer">
          Organized by <b>{prettyName(organizer.name, organizer.email, organizer.self)}</b>
        </div>
      )}

      {attendees.length > 0 && (
        <ul className="cal-attendees">
          {attendees.map((a, i) => (
            <li key={a.email ?? i} className={`cal-att${a.self ? ' me' : ''}`} title={a.email}>
              <span
                className={`rsvp-dot rsvp-${a.response ?? 'needsAction'}`}
                title={RSVP_LABEL[a.response ?? 'needsAction']}
              />
              <span className="cal-att-name">{attendeeName(a)}</span>
              {a.organizer && <span className="cal-att-tag">organizer</span>}
              {a.optional && <span className="cal-att-tag">optional</span>}
            </li>
          ))}
        </ul>
      )}

      {e.description && <div className="cal-desc">{e.description}</div>}
      {e.location && !e.joinUrl && <div className="cal-detail-loc">{e.location}</div>}

      {e.url && (
        <button className="cal-open" onClick={() => openExternal(e.url as string)}>
          <ExternalLink size={12} strokeWidth={2} /> Open in Google Calendar
        </button>
      )}
    </div>
  )
}

/* ---------------- Agenda view ---------------- */

function AgendaView({ config, ctx }: WidgetRenderProps<Config>): JSX.Element {
  const params = { range: config.range || 'today', maxResults: Number(config.maxResults) || 12 }
  const { data, error, loading, refresh } = usePolledQuery<CalendarEvent[]>(
    SERVICE,
    'listUpcomingEvents',
    params,
    { intervalMs: intervalFor(config), refreshToken: ctx.refreshToken }
  )
  const [expanded, setExpanded] = useState<string | null>(null)

  // No data yet → full error / loading state. With data, errors are non-destructive.
  if (!data) {
    if (error) return <CalError error={error} />
    return <div className="svc-empty">Loading…</div>
  }
  const events = data

  const now = Date.now()
  const multiDay = (config.range || 'today') === 'week'
  const nextId = events.find((e) => !e.allDay && new Date(e.start).getTime() > now)?.id

  let lastDay = ''
  return (
    <div className="native-widget calendar">
      <WidgetStatus error={error} loading={loading} onRetry={refresh} />
      {events.length === 0 && <div className="svc-empty">No upcoming events.</div>}
      {events.map((e) => {
        const startMs = new Date(e.start).getTime()
        const endMs = e.end ? new Date(e.end).getTime() : startMs
        const ongoing = !e.allDay && startMs <= now && endMs > now
        const isNext = e.id === nextId
        const isOpen = expanded === e.id
        const guests = e.attendees?.length ?? 0
        const day = dayLabel(e.start)
        const showSep = multiDay && day !== lastDay
        lastDay = day

        return (
          <div key={e.id} className="cal-item">
            {showSep && <div className="cal-day">{day}</div>}
            <div
              className={`cal-event${ongoing ? ' ongoing' : ''}${isNext ? ' next' : ''}${isOpen ? ' open' : ''}`}
            >
              <span className="cal-time">
                <span className="cal-time-start">{eventTimeLabel(e, ongoing)}</span>
                {!e.allDay && !ongoing && durationLabel(e.start, e.end) && (
                  <span className="cal-time-dur">{durationLabel(e.start, e.end)}</span>
                )}
              </span>
              <button className="cal-main" title={e.title} onClick={() => setExpanded(isOpen ? null : e.id)}>
                <ChevronRight className={`cal-caret${isOpen ? ' open' : ''}`} size={13} strokeWidth={2.5} />
                <span className="cal-title">{e.title}</span>
                {guests > 0 && (
                  <span className="cal-guests">
                    <Users size={11} strokeWidth={2} />
                    {guests}
                  </span>
                )}
              </button>
              {e.joinUrl && (
                <button className="cal-join" title="Join" onClick={() => openExternal(e.joinUrl as string)}>
                  <Video size={12} strokeWidth={2} />
                  Join
                </button>
              )}
            </div>
            {isOpen && <EventDetail e={e} />}
          </div>
        )
      })}
    </div>
  )
}

/* ---------------- Day timeline view ---------------- */

const HOUR_PX = 46

function minsSinceMidnight(iso: string): number {
  const d = new Date(iso)
  return d.getHours() * 60 + d.getMinutes()
}

/** Vertical offset (px) of an event's start on the 12am-anchored axis. */
function topOf(e: CalendarEvent): number {
  return (minsSinceMidnight(e.start) / 60) * HOUR_PX
}

/** Hour-axis label, e.g. 0 → 12a, 13 → 1p. */
function hourLabel(h: number): string {
  if (h === 0) return '12a'
  if (h === 12) return '12p'
  return h < 12 ? `${h}a` : `${h - 12}p`
}

/** Day header, e.g. "Today · Jun 17" / "Mon, Jun 23". */
function dayHeaderLabel(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  const md = d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  if (offset === 0) return `Today · ${md}`
  if (offset === -1) return `Yesterday · ${md}`
  if (offset === 1) return `Tomorrow · ${md}`
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

interface Placed {
  e: CalendarEvent
  col: number
  lanes: number
}

/** Assign overlapping events to side-by-side lanes (interval partition by cluster). */
function layout(timed: CalendarEvent[]): Placed[] {
  const sorted = [...timed].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
  const out: Placed[] = []
  let cluster: CalendarEvent[] = []
  let clusterEnd = -Infinity

  const flush = (): void => {
    if (!cluster.length) return
    const colEnd: number[] = []
    const placed = cluster.map((e) => {
      const s = new Date(e.start).getTime()
      const en = new Date(e.end ?? e.start).getTime()
      let col = colEnd.findIndex((end) => end <= s)
      if (col === -1) {
        col = colEnd.length
        colEnd.push(en)
      } else {
        colEnd[col] = en
      }
      return { e, col }
    })
    const lanes = colEnd.length
    placed.forEach((p) => out.push({ ...p, lanes }))
    cluster = []
    clusterEnd = -Infinity
  }

  for (const e of sorted) {
    const s = new Date(e.start).getTime()
    if (s >= clusterEnd && cluster.length) flush()
    cluster.push(e)
    clusterEnd = Math.max(clusterEnd, new Date(e.end ?? e.start).getTime())
  }
  flush()
  return out
}

/** A single positioned event block on the day grid. */
function DayBlock({
  placed,
  now,
  offset,
  onSelect
}: {
  placed: Placed
  now: number
  offset: number
  onSelect: (id: string) => void
}): JSX.Element {
  const { e, col, lanes } = placed
  const GAP = 4 // mild vertical breathing room between stacked events
  const startMs = new Date(e.start).getTime()
  const endMs = new Date(e.end ?? e.start).getTime()
  const rawHeight = Math.max(((endMs - startMs) / 3_600_000) * HOUR_PX, 22)
  const height = Math.max(rawHeight - GAP, 18)
  const ongoing = offset === 0 && startMs <= now && endMs > now
  return (
    <button
      className={`cal-block${ongoing ? ' ongoing' : ''}${height < 34 ? ' compact' : ''}`}
      style={{
        top: topOf(e) + GAP / 2,
        height,
        left: `calc(44px + (100% - 44px) * ${col / lanes})`,
        width: `calc((100% - 44px) / ${lanes} - 4px)`
      }}
      title={`${e.title} · ${timeRange(e)}`}
      onClick={() => onSelect(e.id)}
    >
      <span className="cal-block-title">{e.title}</span>
      {height >= 34 && <span className="cal-block-time">{fmtTime(e.start)}</span>}
    </button>
  )
}

/** The scrollable 24h time grid: hour lines, now-line, and event blocks. */
function DayGrid({
  placed,
  offset,
  onSelect
}: {
  placed: Placed[]
  offset: number
  onSelect: (id: string) => void
}): JSX.Element {
  const gridRef = useRef<HTMLDivElement>(null)
  const now = new Date()
  const nowMs = now.getTime()
  const nowTop = ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_PX
  const showNow = offset === 0

  // Scroll the now-line (or first event) into view when the day changes.
  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    let target = 0
    if (showNow) target = nowTop
    else if (placed.length) target = Math.min(...placed.map((p) => topOf(p.e)))
    el.scrollTop = Math.max(0, target - 60)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset, placed])

  return (
    <div className="cal-grid-scroll" ref={gridRef}>
      <div className="cal-grid" style={{ height: 24 * HOUR_PX }}>
        {Array.from({ length: 25 }, (_, h) => (
          <div key={h} className="cal-hour" style={{ top: h * HOUR_PX }}>
            <span className="cal-hour-label">{hourLabel(h)}</span>
          </div>
        ))}
        {showNow && (
          <div className="cal-now" style={{ top: nowTop }}>
            <span className="cal-now-dot" />
          </div>
        )}
        {placed.map((p) => (
          <DayBlock key={p.e.id} placed={p} now={nowMs} offset={offset} onSelect={onSelect} />
        ))}
      </div>
    </div>
  )
}

function DayView({ config, ctx }: WidgetRenderProps<Config>): JSX.Element {
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)

  const { data, error, loading, refresh } = usePolledQuery<CalendarEvent[]>(
    SERVICE,
    'listDay',
    { dayOffset: offset },
    { intervalMs: intervalFor(config), refreshToken: ctx.refreshToken }
  )

  const events = data ?? []
  const allDay = events.filter((e) => e.allDay)
  const placed = useMemo(() => layout(events.filter((e) => !e.allDay)), [data]) // eslint-disable-line react-hooks/exhaustive-deps
  const selectedEvent = selected ? events.find((e) => e.id === selected) : null

  const body = (): JSX.Element => {
    // No data yet → full error / loading. With data, errors are non-destructive.
    if (!data) {
      if (error) return <CalError error={error} />
      return <div className="svc-empty">Loading…</div>
    }
    return (
      <>
        <WidgetStatus error={error} loading={loading} onRetry={refresh} />
        {allDay.length > 0 && (
          <div className="cal-allday">
            {allDay.map((e) => (
              <button key={e.id} className="cal-allday-chip" onClick={() => setSelected(e.id)}>
                {e.title}
              </button>
            ))}
          </div>
        )}
        <DayGrid placed={placed} offset={offset} onSelect={setSelected} />
      </>
    )
  }

  return (
    <div className="native-widget calendar cal-dayview">
      <div className="cal-day-head">
        <button className="cal-nav" title="Previous day" onClick={() => setOffset((o) => o - 1)}>
          <ChevronLeft size={16} strokeWidth={2} />
        </button>
        <button className="cal-day-title" onClick={() => setOffset(0)} title="Jump to today">
          {dayHeaderLabel(offset)}
        </button>
        <button className="cal-nav" title="Next day" onClick={() => setOffset((o) => o + 1)}>
          <ChevronRight size={16} strokeWidth={2} />
        </button>
      </div>

      {body()}

      {selectedEvent && (
        <div className="cal-overlay">
          <div className="cal-overlay-head">
            <button className="cal-nav" onClick={() => setSelected(null)} title="Back">
              <X size={16} strokeWidth={2} />
            </button>
            <span className="cal-overlay-title">{selectedEvent.title}</span>
            {selectedEvent.joinUrl && (
              <button className="cal-join" onClick={() => openExternal(selectedEvent.joinUrl as string)}>
                <Video size={12} strokeWidth={2} />
                Join
              </button>
            )}
          </div>
          <EventDetail e={selectedEvent} />
        </div>
      )}
    </div>
  )
}

function CalError({ error }: { error: string }): JSX.Element {
  const notConnected = /not connected|reconnect|expired/i.test(error)
  return (
    <div className="svc-empty">
      {notConnected ? 'Connect Google in ⚙ settings to see your calendar.' : error}
    </div>
  )
}

/* ---------------- Widget ---------------- */

function CalendarWidget(props: WidgetRenderProps<Config>): JSX.Element {
  return props.config.view === 'day' ? <DayView {...props} /> : <AgendaView {...props} />
}

export default defineWidget<Config>({
  manifest: {
    id: 'calendar',
    name: 'Calendar',
    icon: CalendarIcon,
    serviceId: 'google',
    description: 'Google Calendar — agenda list or a day timeline, with attendees & one-click join.',
    defaultSize: { w: 4, h: 6 },
    minSize: { w: 3, h: 3 },
    capabilities: { refreshable: true },
    configSchema: {
      title: field.text({ label: 'Title' }),
      view: field.select({
        label: 'View',
        default: 'agenda',
        options: [
          { label: 'Agenda', value: 'agenda' },
          { label: 'Day timeline', value: 'day' }
        ]
      }),
      range: field.select({
        label: 'Agenda range',
        default: 'today',
        options: [
          { label: 'Today', value: 'today' },
          { label: 'Next 24 hours', value: 'day' },
          { label: 'Next 7 days', value: 'week' }
        ]
      }),
      maxResults: field.number({ label: 'Max events (agenda)', default: 12 }),
      refreshMin: field.number({ label: 'Refresh (min)', default: 15, help: '0 = manual' })
    }
  },
  render: CalendarWidget
})

import { secrets } from '@main/persistence/secrets'
import type { ServiceStatus } from '@shared/types/services'
import type { CalendarEvent } from '@shared/types/calendar'
import { ServiceError, type BackendService } from './types'
import { refreshAccessToken, runOAuth } from './googleOAuth'

const SECRET_KEY = 'service:google'
const CAL_BASE = 'https://www.googleapis.com/calendar/v3'

interface Stored {
  clientId: string
  clientSecret: string
  refreshToken: string
  email: string
}

// Access token cached in memory only; refreshed on demand from the stored refresh token.
let accessCache: { token: string; expiresAt: number } | null = null

function load(): Stored | null {
  const raw = secrets.get(SECRET_KEY)
  return raw ? (JSON.parse(raw) as Stored) : null
}

async function getAccessToken(): Promise<string> {
  const s = load()
  if (!s) throw new ServiceError('Google not connected.', 401)
  if (accessCache && accessCache.expiresAt > Date.now() + 30_000) return accessCache.token
  try {
    const { accessToken, expiresAt } = await refreshAccessToken(
      s.clientId,
      s.clientSecret,
      s.refreshToken
    )
    accessCache = { token: accessToken, expiresAt }
    return accessToken
  } catch {
    // Refresh token revoked/invalid → surface as auth error so the user reconnects.
    throw new ServiceError('Google session expired — reconnect in settings.', 401)
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function calCall(path: string, params: Record<string, string>): Promise<any> {
  const token = await getAccessToken()
  const url = `${CAL_BASE}${path}?${new URLSearchParams(params).toString()}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    let detail = ''
    try {
      const j = await res.json()
      detail = j?.error?.message || ''
    } catch {
      /* no body */
    }
    console.warn(`[google] calendar ${res.status}: ${detail}`)
    if (res.status === 401) {
      accessCache = null
      throw new ServiceError('Google session expired — reconnect in settings.', 401)
    }
    if (res.status === 403) {
      // "API not enabled / disabled" is transient — it heals once the user enables
      // the Calendar API, so throw WITHOUT an auth status so the scheduler keeps
      // retrying (no reconnect needed). A real permission/scope 403 stays auth.
      if (/not been used|disabled|not enabled/i.test(detail)) {
        throw new ServiceError(detail)
      }
      throw new ServiceError(detail || 'Google denied access — check Calendar API scope.', 403)
    }
    if (res.status === 429) throw new ServiceError('Google rate-limited.', 429)
    throw new ServiceError(detail || `Google Calendar request failed (${res.status}).`, res.status)
  }
  return res.json()
}

function joinUrlOf(item: any): string | undefined {
  if (item.hangoutLink) return item.hangoutLink
  const ep = item.conferenceData?.entryPoints?.find((e: any) => e.entryPointType === 'video')
  if (ep?.uri) return ep.uri
  const m = (item.location as string | undefined)?.match(/https?:\/\/\S+/)
  return m?.[0]
}

function stripHtml(s?: string): string | undefined {
  if (!s) return undefined
  const text = s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text ? text.slice(0, 800) : undefined
}

function mapEvent(item: any): CalendarEvent {
  const allDay = Boolean(item.start?.date && !item.start?.dateTime)
  return {
    id: item.id,
    title: item.summary || '(no title)',
    start: item.start?.dateTime ?? item.start?.date,
    end: item.end?.dateTime ?? item.end?.date,
    allDay,
    location: item.location,
    joinUrl: joinUrlOf(item),
    url: item.htmlLink,
    status: item.status,
    description: stripHtml(item.description),
    organizer: item.organizer
      ? { email: item.organizer.email, name: item.organizer.displayName, self: item.organizer.self }
      : undefined,
    attendees: Array.isArray(item.attendees)
      ? item.attendees
          .filter((a: any) => !a.resource) // drop rooms/equipment
          .map((a: any) => ({
            email: a.email,
            name: a.displayName,
            self: a.self,
            organizer: a.organizer,
            response: a.responseStatus,
            optional: a.optional
          }))
      : undefined
  }
}

/** End of the window to fetch, given a coarse range token (keeps the poll key stable). */
function timeMaxFor(range: string): string | undefined {
  const now = new Date()
  if (range === 'today') {
    const d = new Date(now)
    d.setHours(23, 59, 59, 999)
    return d.toISOString()
  }
  if (range === 'day') return new Date(now.getTime() + 24 * 3600_000).toISOString()
  if (range === 'week') return new Date(now.getTime() + 7 * 24 * 3600_000).toISOString()
  return undefined
}

async function fetchEvents(calendarId: string, q: Record<string, string>): Promise<CalendarEvent[]> {
  const data = await calCall(`/calendars/${encodeURIComponent(calendarId)}/events`, q)
  const items = Array.isArray(data.items) ? data.items : []
  return items.filter((i: any) => i.status !== 'cancelled').map(mapEvent)
}

export const googleService: BackendService = {
  id: 'google',

  async status(): Promise<ServiceStatus> {
    const s = load()
    return s ? { connected: true, account: s.email || 'Google' } : { connected: false }
  },

  async connect(creds): Promise<ServiceStatus> {
    const clientId = String(creds.clientId ?? '').trim()
    const clientSecret = String(creds.clientSecret ?? '').trim()
    if (!clientId || !clientSecret) {
      return { connected: false, error: 'Enter the OAuth Client ID and Client secret.' }
    }
    try {
      const tok = await runOAuth(clientId, clientSecret)
      const stored: Stored = {
        clientId,
        clientSecret,
        refreshToken: tok.refreshToken,
        email: tok.email
      }
      secrets.set(SECRET_KEY, JSON.stringify(stored))
      accessCache = { token: tok.accessToken, expiresAt: tok.expiresAt }
      return { connected: true, account: tok.email || 'Google' }
    } catch (e) {
      return { connected: false, error: e instanceof Error ? e.message : 'Google sign-in failed.' }
    }
  },

  async disconnect(): Promise<ServiceStatus> {
    secrets.delete(SECRET_KEY)
    accessCache = null
    return { connected: false }
  },

  async query(method, params): Promise<unknown> {
    const calendarId = String(params.calendarId || 'primary')

    if (method === 'listUpcomingEvents') {
      const q: Record<string, string> = {
        singleEvents: 'true',
        orderBy: 'startTime',
        timeMin: new Date().toISOString(),
        maxResults: String(Number(params.maxResults) || 12)
      }
      const timeMax = timeMaxFor(String(params.range || 'today'))
      if (timeMax) q.timeMax = timeMax
      return fetchEvents(calendarId, q)
    }

    if (method === 'listDay') {
      // Whole local day at `dayOffset` from today (negative = past).
      const day = new Date()
      day.setDate(day.getDate() + (Number(params.dayOffset) || 0))
      const start = new Date(day)
      start.setHours(0, 0, 0, 0)
      const end = new Date(day)
      end.setHours(23, 59, 59, 999)
      return fetchEvents(calendarId, {
        singleEvents: 'true',
        orderBy: 'startTime',
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        maxResults: '50'
      })
    }

    throw new Error(`Unknown google method: ${method}`)
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

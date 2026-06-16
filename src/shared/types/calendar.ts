/** A meeting attendee's RSVP. */
export type RsvpStatus = 'accepted' | 'declined' | 'tentative' | 'needsAction'

export interface Attendee {
  email?: string
  name?: string
  /** True if this attendee is you. */
  self?: boolean
  /** True if this attendee is the organizer. */
  organizer?: boolean
  response?: RsvpStatus
  optional?: boolean
}

/** A calendar event, normalized from the Google Calendar API. */
export interface CalendarEvent {
  id: string
  title: string
  /** ISO datetime (timed) or YYYY-MM-DD (all-day) of the start. */
  start: string
  /** ISO datetime / date of the end. */
  end?: string
  allDay: boolean
  location?: string
  /** Video-conference link (Meet/Zoom/…), if any. */
  joinUrl?: string
  /** Link to open the event in Google Calendar. */
  url?: string
  status?: string
  /** Agenda / notes (plain text, HTML stripped). */
  description?: string
  organizer?: { email?: string; name?: string; self?: boolean }
  attendees?: Attendee[]
}

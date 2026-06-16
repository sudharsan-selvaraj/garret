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
}

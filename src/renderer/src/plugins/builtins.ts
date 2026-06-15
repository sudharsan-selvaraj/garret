import type { AnyWidgetPlugin } from '@sdk'
import { registry } from '@renderer/plugins/registry'
import webEmbed from '@plugins/web-embed'
import googleCalendar from '@plugins/google-calendar'
import jiraBoard from '@plugins/jira-board'
import jiraTickets from '@plugins/jira-tickets'
import bitbucketPrs from '@plugins/bitbucket-prs'
import clock from '@plugins/clock'
import notes from '@plugins/notes'
import weather from '@plugins/weather'

/**
 * The single touchpoint for shipping a new built-in widget: add it here.
 * (Everything else about a widget lives in its own module under src/plugins.)
 */
const builtins: AnyWidgetPlugin[] = [
  jiraTickets,
  bitbucketPrs,
  googleCalendar,
  jiraBoard,
  clock,
  weather,
  notes,
  webEmbed
]

let done = false
export function registerBuiltins(): void {
  if (done) return
  registry.registerAll(builtins)
  done = true
}

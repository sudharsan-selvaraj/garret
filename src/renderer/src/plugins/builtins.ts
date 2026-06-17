import type { AnyWidgetPlugin } from '@sdk'
import { registry } from '@renderer/plugins/registry'
import webEmbed from '@plugins/web-embed'
import jiraTickets from '@plugins/jira-tickets'
import pullRequests from '@plugins/pull-requests'
import gitRepo from '@plugins/git-repo'
import clock from '@plugins/clock'
import notes from '@plugins/notes'
import weather from '@plugins/weather'
import devTools from '@plugins/dev-tools'
import snippets from '@plugins/snippets'
import calendar from '@plugins/calendar'

/**
 * The single touchpoint for shipping a new built-in widget: add it here.
 * (Everything else about a widget lives in its own module under src/plugins.)
 */
const builtins: AnyWidgetPlugin[] = [
  jiraTickets,
  calendar,
  pullRequests,
  gitRepo,
  clock,
  weather,
  notes,
  devTools,
  snippets,
  webEmbed
]

let done = false
export function registerBuiltins(): void {
  if (done) return
  registry.registerAll(builtins)
  done = true
}

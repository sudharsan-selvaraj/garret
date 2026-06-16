import type { AnyWidgetPlugin } from '@sdk'
import { registry } from '@renderer/plugins/registry'
import webEmbed from '@plugins/web-embed'
import googleCalendar from '@plugins/google-calendar'
import jiraBoard from '@plugins/jira-board'
import jiraTickets from '@plugins/jira-tickets'
import bitbucketPrs from '@plugins/bitbucket-prs'
import bitbucketMyPrs from '@plugins/bitbucket-my-prs'
import bitbucketReviewPrs from '@plugins/bitbucket-review-prs'
import gitRepo from '@plugins/git-repo'
import clock from '@plugins/clock'
import notes from '@plugins/notes'
import weather from '@plugins/weather'
import devTools from '@plugins/dev-tools'

/**
 * The single touchpoint for shipping a new built-in widget: add it here.
 * (Everything else about a widget lives in its own module under src/plugins.)
 */
const builtins: AnyWidgetPlugin[] = [
  jiraTickets,
  bitbucketMyPrs,
  bitbucketReviewPrs,
  bitbucketPrs,
  googleCalendar,
  jiraBoard,
  gitRepo,
  clock,
  weather,
  notes,
  devTools,
  webEmbed
]

let done = false
export function registerBuiltins(): void {
  if (done) return
  registry.registerAll(builtins)
  done = true
}

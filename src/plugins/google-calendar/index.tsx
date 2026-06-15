import { Calendar } from 'lucide-react'
import { field } from '@sdk'
import { defineWebEmbedWidget } from '@plugins/web-embed'

interface Config {
  url: string
}

/** Example of "add a widget in ~10 lines" — declarative, no bespoke UI. */
export default defineWebEmbedWidget<Config>({
  id: 'google-calendar',
  name: 'Google Calendar',
  icon: Calendar,
  description: 'Your Google Calendar, embedded.',
  defaultSize: { w: 5, h: 7 },
  config: {
    url: field.url({
      label: 'Calendar URL',
      required: true,
      help: 'Paste your https://calendar.google.com/ URL, or a Calendar “embed” URL.',
      placeholder: 'https://calendar.google.com/calendar/u/0/r'
    })
  },
  src: (cfg) => cfg.url
})

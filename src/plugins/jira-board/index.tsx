import { SquareKanban } from 'lucide-react'
import { field } from '@sdk'
import { defineWebEmbedWidget } from '@plugins/web-embed'

interface Config {
  url: string
}

export default defineWebEmbedWidget<Config>({
  id: 'jira-board',
  name: 'Jira Board',
  icon: SquareKanban,
  description: 'A Jira board, backlog, or filter — embedded.',
  defaultSize: { w: 7, h: 8 },
  config: {
    url: field.url({
      label: 'Jira board URL',
      required: true,
      placeholder: 'https://your-domain.atlassian.net/jira/software/projects/ABC/boards/1'
    })
  },
  src: (cfg) => cfg.url
})

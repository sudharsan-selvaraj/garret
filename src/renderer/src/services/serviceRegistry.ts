import { Boxes } from 'lucide-react'
import { field, type ServiceDefinition } from '@sdk'

/** Registry of service definitions (the groups widgets belong to). */
class ServiceRegistry {
  private readonly services = new Map<string, ServiceDefinition>()

  register(def: ServiceDefinition): void {
    this.services.set(def.id, def)
  }
  get(id: string): ServiceDefinition | undefined {
    return this.services.get(id)
  }
  list(): ServiceDefinition[] {
    return [...this.services.values()]
  }
}

export const serviceRegistry = new ServiceRegistry()

/** Built-in service definitions. New services (Google, …) register here. */
let done = false
export function registerServices(): void {
  if (done) return
  serviceRegistry.register({
    id: 'atlassian',
    name: 'Atlassian',
    icon: Boxes,
    description: 'Jira + Bitbucket Cloud. One account: email + an Atlassian API token.',
    requiresConnection: true,
    connectionSchema: {
      email: field.text({ label: 'Email', required: true, placeholder: 'you@company.com' }),
      apiToken: field.password({ label: 'API token', required: true, placeholder: 'paste token' }),
      jiraSite: field.text({ label: 'Jira site', placeholder: 'your-domain.atlassian.net (for Jira)' }),
      bitbucketToken: field.password({
        label: 'Bitbucket token',
        placeholder: 'optional — only if your API token lacks Bitbucket scope'
      })
    }
  })
  done = true
}

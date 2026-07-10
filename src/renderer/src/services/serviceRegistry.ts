import { CalendarDays } from 'lucide-react'
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
    id: 'google',
    name: 'Google',
    icon: CalendarDays,
    description:
      'Google Calendar (read-only). Create a Desktop OAuth client in Google Cloud, then sign in.',
    requiresConnection: true,
    connectionSchema: {
      clientId: field.text({
        label: 'Client ID',
        required: true,
        placeholder: '…apps.googleusercontent.com'
      }),
      clientSecret: field.password({
        label: 'Client secret',
        required: true,
        placeholder: 'GOCSPX-…'
      })
    }
  })
  done = true
}

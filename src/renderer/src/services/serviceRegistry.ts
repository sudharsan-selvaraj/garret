import { type ServiceDefinition } from '@sdk'

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

/** Built-in service definitions register here. (Google moved to the garret.google pack.) */
let done = false
export function registerServices(): void {
  if (done) return
  done = true
}

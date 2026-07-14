import type { BackendService } from './types'

/** Main-side service registry. Empty — built-in service widgets were migrated to packs. */
const services: Record<string, BackendService> = {}

export function getService(id: string): BackendService {
  const svc = services[id]
  if (!svc) throw new Error(`Unknown service: ${id}`)
  return svc
}

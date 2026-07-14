import type { BackendService } from './types'
import { gitService } from './git'

/** Main-side service registry. New integrations register here. */
const services: Record<string, BackendService> = {
  [gitService.id]: gitService
}

export function getService(id: string): BackendService {
  const svc = services[id]
  if (!svc) throw new Error(`Unknown service: ${id}`)
  return svc
}

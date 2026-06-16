import type { BackendService } from './types'
import { atlassianService } from './atlassian'
import { gitService } from './git'

/** Main-side service registry. New integrations (Google, …) register here. */
const services: Record<string, BackendService> = {
  [atlassianService.id]: atlassianService,
  [gitService.id]: gitService
}

export function getService(id: string): BackendService {
  const svc = services[id]
  if (!svc) throw new Error(`Unknown service: ${id}`)
  return svc
}

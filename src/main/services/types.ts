import type { ServiceStatus } from '@shared/types/services'

/** Error carrying the HTTP status so the poll scheduler can classify it (auth / rate-limit / transient). */
export class ServiceError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly retryAfterMs?: number
  ) {
    super(message)
    this.name = 'ServiceError'
  }
}

/**
 * A main-side integration: handles auth (token/OAuth), holds credentials in the
 * encrypted secret store, and answers typed data queries. Renderer widgets reach
 * these only via IPC — tokens never cross to the renderer.
 */
export interface BackendService {
  id: string
  status(): Promise<ServiceStatus>
  connect(creds: Record<string, unknown>): Promise<ServiceStatus>
  disconnect(): Promise<ServiceStatus>
  query(method: string, params: Record<string, unknown>): Promise<unknown>
}

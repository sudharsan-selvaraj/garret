import { useCallback, useEffect, useState } from 'react'
import type { ServiceStatus } from '@shared/types/services'

/**
 * The official plugin API for backend data services. Calls cross to the main
 * process over IPC — credentials and HTTP requests live there, never here.
 */
export const services = {
  status: (id: string): Promise<ServiceStatus> => window.myview.services.status(id),
  connect: (id: string, creds: Record<string, unknown>): Promise<ServiceStatus> =>
    window.myview.services.connect(id, creds),
  disconnect: (id: string): Promise<ServiceStatus> => window.myview.services.disconnect(id),
  query: <T = unknown>(id: string, method: string, params: Record<string, unknown>): Promise<T> =>
    window.myview.services.query<T>(id, method, params)
}

/** Open a URL in the user's default browser. */
export function openExternal(url: string): void {
  window.myview.openExternal(url)
}

/** Track a service's connection status; `setStatus` lets a connect/disconnect update it. */
export function useServiceStatus(serviceId: string): {
  status: ServiceStatus | null
  refresh: () => void
  setStatus: (s: ServiceStatus) => void
} {
  const [status, setStatus] = useState<ServiceStatus | null>(null)
  const refresh = useCallback(() => {
    void services.status(serviceId).then(setStatus)
  }, [serviceId])
  useEffect(refresh, [refresh])
  return { status, refresh, setStatus }
}

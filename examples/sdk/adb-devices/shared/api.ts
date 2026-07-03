/** A serializable view of an adb device (bigint transportId stringified for the wire). */
export interface AdbDevice {
  serial: string
  state: 'unauthorized' | 'offline' | 'device'
  product?: string
  model?: string
  device?: string
  transportId: string
}

export type AdbConnState = 'connecting' | 'connected' | 'no-adb' | 'error'

/** Whether the local adb server is reachable, and if not, why (drives the UI's guidance). */
export interface AdbStatus {
  ok: boolean
  state: AdbConnState
  /** user-facing hint when `!ok` (e.g. how to install platform-tools). */
  error?: string
}

/** Host methods the UI calls (the controller boundary). */
export interface Api {
  status(): Promise<AdbStatus>
  /** Current device list (also pushed live via the `devices:changed` event). */
  listDevices(): Promise<AdbDevice[]>
  /** Re-attempt the adb connection (after the user installs platform-tools / plugs in). */
  retry(): Promise<void>
}

/** Host → UI events (live, event-driven — no polling). A `type` (not `interface`) so it satisfies the
 *  SDK's `EventMap` index-signature constraint. */
export type Events = {
  'devices:changed': AdbDevice[]
  'adb:status': AdbStatus
}

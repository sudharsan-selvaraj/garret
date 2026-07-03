/** A serializable view of an adb device (bigint transportId stringified for the wire). */
export interface AdbDevice {
  serial: string
  state: 'unauthorized' | 'offline' | 'device'
  product?: string
  model?: string
  device?: string
  transportId: string
}

export interface Api {
  /** List devices the local adb server knows about. Throws if the adb server isn't reachable. */
  listDevices(): Promise<AdbDevice[]>
}

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

/** Tunables for a scrcpy mirror session (all optional; sensible defaults in the host). */
export interface MirrorConfig {
  videoBitRate?: number
  maxFps?: number
  /** longest edge in px; 0 = device native. */
  maxSize?: number
}

/** Video packets streamed host→UI: one `meta` first, then a `config` (SPS/PPS), then `frame`s. */
export type VideoChunk =
  | { kind: 'meta'; width: number; height: number; videoCodec: string; audioCodec: string | null }
  | { kind: 'config'; data: Uint8Array }
  | { kind: 'frame'; data: Uint8Array; keyframe: boolean; timestamp: number }

/** Audio packets (absent on Android <11): a `config` then `frame`s. */
export type AudioChunk =
  | { kind: 'config'; data: Uint8Array }
  | { kind: 'frame'; data: Uint8Array; timestamp: number }

/** Host methods the UI calls (the controller boundary). Import Stream from '@garretapp/sdk'. */
export interface Api {
  status(): Promise<AdbStatus>
  /** Current device list (also pushed live via the `devices:changed` event). */
  listDevices(): Promise<AdbDevice[]>
  /** Re-attempt the adb connection (after the user installs platform-tools / plugs in). */
  retry(): Promise<void>
  /** Live H.264 video for a device (mirror surface). Starts the scrcpy session on subscribe. */
  mirror(args: { serial: string } & MirrorConfig): import('@garretapp/sdk').Stream<VideoChunk>
  /** Live Opus audio for a device; the stream ends immediately on Android <11. */
  audio(args: { serial: string }): import('@garretapp/sdk').Stream<AudioChunk>
}

/** Host → UI events (live, event-driven — no polling). A `type` (not `interface`) so it satisfies the
 *  SDK's `EventMap` index-signature constraint. */
export type Events = {
  'devices:changed': AdbDevice[]
  'adb:status': AdbStatus
}

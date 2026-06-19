/**
 * The host↔guest message protocol for sandboxed widgets (carried over the webview IPC
 * channel). Shared by the guest `bridgeClient` (garret-widget-sdk) and the host
 * `BridgeHost` (the app) so both ends agree on the wire shapes. Every payload is
 * structured-clone-safe (no functions, no DOM). See docs/sandbox-design.md §4.
 */

/** Messages a sandboxed widget (guest) sends to the host. */
export type GuestMessage =
  | { kind: 'ready' }
  /** A capability call. With `id` the host replies result/error; without, fire-and-forget. */
  | { kind: 'call'; id?: string; method: string; args: unknown[] }
  /** The widget asked to patch its own persisted config (ctx.updateConfig). */
  | { kind: 'updateConfig'; patch: Record<string, unknown> }

/** Messages the host sends to a sandboxed widget (guest). */
export type HostMessage =
  | { kind: 'init'; instanceId: string; config: Record<string, unknown>; refreshToken: number }
  | { kind: 'result'; id: string; value: unknown }
  | { kind: 'error'; id: string; message: string }
  /** A pushed poll update (payload: PollUpdate) or file-watch tick (payload: watchId). */
  | { kind: 'event'; channel: 'poll' | 'watch'; payload: unknown }
  | { kind: 'config'; config: Record<string, unknown> }
  | { kind: 'refresh' }
  | { kind: 'teardown' }

/**
 * The thin transport the host's bridge-preload exposes to the guest realm via
 * contextBridge (`window.__garretBridge`). It carries no capability — just messages.
 */
export interface BridgeTransport {
  post(msg: GuestMessage): void
  onMessage(cb: (msg: HostMessage) => void): void
}

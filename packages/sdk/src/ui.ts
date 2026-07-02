/** `@garret/sdk/ui` — framework-agnostic UI client (vanilla / Svelte / Vue). React authors use
 *  `@garret/sdk/react` instead. */
export { createHostClient } from './client'
export type { HostClientOptions, Client } from './client'
export {
  getGarret,
  getRuntime,
  getHostTransport,
  getInstanceId
} from './platform'
export type { GarretPlatform, GarretRuntime, ServiceClient, StorageApi, SecretsApi } from './platform'
export { GarretError } from './errors'
export { defineManifest, defineConfig } from './types'
export type { Stream, StreamCall, HostClient, EventMap, Manifest, Capability } from './types'

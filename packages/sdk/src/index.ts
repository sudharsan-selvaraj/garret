/** `@garret/sdk` — shared types + helpers. Import the runtimes from the subpaths:
 *  `@garret/sdk/host` (defineHost), `@garret/sdk/ui` (createHostClient/getGarret), `@garret/sdk/react`. */
export { GarretError, garretErrorFromWire } from './errors'
export { parseArgv } from './argv'
export type { GarretErrorCode, GarretErrorOptions } from './errors'
export { defineManifest, defineConfig } from './types'
export type {
  Stream,
  StreamCall,
  HostClient,
  EventMap,
  Capability,
  Manifest,
  ConfigField,
  ConfigFieldType,
  ConfigSchema
} from './types'
export type { WireMessage, Transport, CallId } from './protocol'
export { ACTIVE_CHANNEL } from './protocol'

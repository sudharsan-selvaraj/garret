/** Typed errors that travel across the bridge (see docs/garret.html §Errors). */
export type GarretErrorCode =
  | 'BINARY_NOT_FOUND'
  | 'NOT_FOUND'
  | 'PERMISSION'
  | 'UNAVAILABLE'
  | 'BAD_ARGS'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'NETWORK'
  | 'INTERNAL'

export interface GarretErrorOptions {
  /** e.g. an install command for BINARY_NOT_FOUND. */
  hint?: string
}

/**
 * The single error type crossing the bridge. `code` lets the UI branch (offer `brew install` on
 * BINARY_NOT_FOUND, an auth prompt on PERMISSION, …). Thrown host-side, re-thrown client-side.
 */
export class GarretError extends Error {
  readonly code: GarretErrorCode
  readonly hint?: string

  constructor(code: GarretErrorCode, message: string, options?: GarretErrorOptions) {
    super(message)
    this.name = 'GarretError'
    this.code = code
    this.hint = options?.hint
    // Restore prototype chain across the transpile target (extends Error caveat).
    Object.setPrototypeOf(this, GarretError.prototype)
  }
}

/** Reconstruct a GarretError from a wire error frame (client side). */
export function garretErrorFromWire(code: string, message: string, hint?: string): GarretError {
  const known: GarretErrorCode[] = [
    'BINARY_NOT_FOUND',
    'NOT_FOUND',
    'PERMISSION',
    'UNAVAILABLE',
    'BAD_ARGS',
    'TIMEOUT',
    'CANCELLED',
    'NETWORK',
    'INTERNAL'
  ]
  const c = (known as string[]).includes(code) ? (code as GarretErrorCode) : 'INTERNAL'
  return new GarretError(c, message, hint ? { hint } : undefined)
}

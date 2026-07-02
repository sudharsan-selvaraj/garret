import type { Stream } from '@garretapp/sdk'

export interface Api {
  /** Run a command; streams stdout/stderr, ends with the exit code. */
  run(a: { argv: string[] }): Stream<string, { code: number }>
}

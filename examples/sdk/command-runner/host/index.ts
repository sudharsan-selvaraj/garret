import { defineHost } from '@garretapp/sdk/host'
import type { Api } from '../shared/api'

export default defineHost<Api>((ctx) => ({
  // Chunk/Result are inferred from Api's `run` return type; `signal` kills the child on cancel/unmount.
  run: ({ argv }) =>
    ctx.stream((out, signal) => {
      const child = ctx.spawn(argv, { signal })
      child.stdout?.on('data', (d: Buffer) => out.push(d.toString()))
      child.stderr?.on('data', (d: Buffer) => out.push(d.toString()))
      child.on('error', (e) => out.error(e))
      child.on('close', (code) => out.end({ code: code ?? 0 }))
    })
}))

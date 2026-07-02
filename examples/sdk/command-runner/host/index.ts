import { defineHost } from '@garretapp/sdk/host'
import type { Api } from '../shared/api'

export default defineHost<Api>((ctx) => ({
  run: ({ argv }) =>
    ctx.stream<string, { code: number }>((out) => {
      const child = ctx.spawn(argv)
      child.stdout?.on('data', (d: Buffer) => out.push(d.toString()))
      child.stderr?.on('data', (d: Buffer) => out.push(d.toString()))
      child.on('error', (e) => out.error(e))
      child.on('close', (code) => out.end({ code: code ?? 0 }))
    })
}))

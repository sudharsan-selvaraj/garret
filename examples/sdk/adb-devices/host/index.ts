import { defineHost } from '@garretapp/sdk/host'
import { AdbServerClient } from '@yume-chan/adb'
import { AdbServerNodeTcpConnector } from '@yume-chan/adb-server-node-tcp'
import type { Api } from '../shared/api'

// ya-webadb is pure TypeScript — it bundles into this raw-Node host with esbuild (no native .node
// addon, which the installer would reject). We talk to the *local adb server* over TCP (the daemon
// the `adb` CLI / Android Studio starts on 127.0.0.1:5037), so no adb binary needs to be on PATH.
export default defineHost<Api>((ctx) => {
  const connector = new AdbServerNodeTcpConnector({ host: '127.0.0.1', port: 5037 })
  const client = new AdbServerClient(connector)

  return {
    listDevices: async () => {
      const devices = await client.getDevices()
      ctx.log(`adb: ${devices.length} device(s)`)
      return devices.map((d) => ({
        serial: d.serial,
        state: d.state,
        product: d.product,
        model: d.model,
        device: d.device,
        transportId: String(d.transportId) // bigint → string for the wire
      }))
    }
  }
})

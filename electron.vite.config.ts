import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Module boundaries enforced by aliases. Import direction must flow downward:
//   plugins → sdk → shared,  and  main/renderer → sdk → shared.
const alias = {
  '@shared': resolve(__dirname, 'src/shared'),
  '@main': resolve(__dirname, 'src/main'),
  '@renderer': resolve(__dirname, 'src/renderer/src'),
  '@plugins': resolve(__dirname, 'src/plugins'),
  // Unified SDK — subpaths BEFORE the bare specifier so they match first. Resolves to TS source so
  // it's bundled in-repo (no pre-build step in dev). Published builds ship compiled dist instead.
  '@garretapp/sdk/host': resolve(__dirname, 'packages/sdk/src/host.ts'),
  '@garretapp/sdk/ui': resolve(__dirname, 'packages/sdk/src/ui.ts'),
  '@garretapp/sdk/react': resolve(__dirname, 'packages/sdk/src/react.ts'),
  '@garretapp/sdk': resolve(__dirname, 'packages/sdk/src/index.ts'),
  // Pack manifest rulebook — resolves to TS source too (bundled, not externalized).
  '@garretapp/pack-schema': resolve(__dirname, 'packages/pack-schema/src/index.ts')
}

// These workspace packages must be BUNDLED (not externalized) since they resolve to TS source —
// a runtime `require()` would have nothing to load.
const externalize = (): ReturnType<typeof externalizeDepsPlugin> =>
  externalizeDepsPlugin({ exclude: ['@garretapp/sdk', '@garretapp/pack-schema'] })

export default defineConfig({
  main: {
    resolve: { alias },
    plugins: [externalize()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    resolve: { alias },
    plugins: [externalize()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          // Unified extension bridge (window.__garret) — one preload for web + native.
          extBridge: resolve(__dirname, 'src/preload/extBridge.ts')
        }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias },
    // The renderer has no Node `process` (no nodeIntegration). Some deps
    // (react-draggable inside react-grid-layout) read process.env at runtime —
    // shim it to an empty object so those reads return undefined instead of throwing.
    define: { 'process.env': {} },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    },
    plugins: [react()]
  }
})

import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Module boundaries enforced by aliases. Import direction must flow downward:
//   plugins → sdk → shared,  and  main/renderer → sdk → shared.
const alias = {
  '@shared': resolve(__dirname, 'src/shared'),
  '@sdk': resolve(__dirname, 'src/sdk'),
  '@main': resolve(__dirname, 'src/main'),
  '@renderer': resolve(__dirname, 'src/renderer/src'),
  '@plugins': resolve(__dirname, 'src/plugins'),
  // Workspace SDK packages — resolve to TS source so they're bundled in-repo (no
  // pre-build step in dev). Published builds ship compiled dist instead.
  'garret-core': resolve(__dirname, 'packages/core/src'),
  'garret-widget-sdk': resolve(__dirname, 'packages/widget-sdk/src')
}

// The SDK workspace packages must be BUNDLED (not externalized) since they resolve
// to TS source — a runtime `require('garret-core')` would have nothing to load.
const externalize = (): ReturnType<typeof externalizeDepsPlugin> =>
  externalizeDepsPlugin({ exclude: ['garret-core', 'garret-widget-sdk'] })

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
          // Bridge preload injected into sandboxed widget webviews (step 2).
          sandboxBridge: resolve(__dirname, 'src/preload/sandboxBridge.ts'),
          // Bridge preload for native-extension UI webviews (native tier).
          nativeBridge: resolve(__dirname, 'src/preload/nativeBridge.ts')
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

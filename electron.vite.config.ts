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
  '@plugins': resolve(__dirname, 'src/plugins')
}

export default defineConfig({
  main: {
    resolve: { alias },
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    resolve: { alias },
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
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

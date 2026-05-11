import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Build-time injection of the admin-PIN hash. CI passes
// TRENTCAD_ADMIN_PIN_HASH from a GitHub Actions secret; in dev / local
// builds the var is empty and the admin page opens without a PIN
// prompt (so devs aren't locked out).
const adminPinHash = JSON.stringify(process.env.TRENTCAD_ADMIN_PIN_HASH || '')

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    define: {
      __TRENTCAD_ADMIN_PIN_HASH__: adminPinHash
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve('src/renderer'),
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        }
      }
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    define: {
      __TRENTCAD_ADMIN_PIN_HASH__: adminPinHash
    }
  }
})

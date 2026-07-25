import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  root: '.',
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
    rollupOptions: {
      input: { index: resolve(__dirname, 'index.html') }
    }
  },
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 5174
        }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**']
    },
    proxy: {
      '/api': {
        target: process.env['MYSQL_COMPARE_WEB_API_PROXY'] || 'http://127.0.0.1:3000',
        changeOrigin: true
      }
    }
  },
  envPrefix: ['VITE_', 'TAURI_']
})

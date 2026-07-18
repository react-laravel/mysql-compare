import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

export default defineConfig({
  root: '.',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  server: {
    proxy: {
      '/api': {
        target: process.env['MYSQL_COMPARE_WEB_API_PROXY'] || 'http://127.0.0.1:3000',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist-web',
    rollupOptions: {
      input: { index: resolve(__dirname, 'index.html') }
    }
  }
})

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The browser talks to Vite (port 5173); Vite forwards /api and /ws calls to the
// Python backend (port 8000). This avoids CORS problems during development.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      // `ws: true` makes Vite forward the WebSocket upgrade. `changeOrigin`
      // keeps the Host header pointing at the backend, so the proxy behaves
      // exactly like a direct connection.
      '/ws': { target: 'ws://127.0.0.1:8000', changeOrigin: true, ws: true },
    },
  },
})

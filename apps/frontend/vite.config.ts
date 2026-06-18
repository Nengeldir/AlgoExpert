import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      // Proxy API calls in dev so CORS is never an issue locally
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/admin': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        bypass(req) {
          // Browser navigation sends Accept: text/html — serve the SPA so React Router handles it.
          // Programmatic fetch() calls (Accept: */* or application/json) are proxied to the backend.
          if (req.headers.accept?.includes('text/html')) return '/index.html'
        },
      },
    },
  },
  // PWA manifest is in public/ — Vite serves it automatically
})

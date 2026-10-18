import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/market-image': {
        target: 'https://polymarket-upload.s3.us-east-2.amazonaws.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/market-image/, ''),
      },
      '/api/polymarket': {
        target: 'https://gamma-api.polymarket.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/polymarket/, ''),
      },
    },
  },
})

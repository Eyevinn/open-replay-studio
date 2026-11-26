import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  envPrefix: ['OPEN_REPLAY_'],
  server: { port: 5174 },
  plugins: [react()],
})

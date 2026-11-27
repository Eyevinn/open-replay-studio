import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  envPrefix: ['OPEN_REPLAY_'],
  server: { port: 5174 },
  plugins: [react()],
  // Tests live next to the code (`*.test.ts`, `*.test.tsx`) and run in jsdom.
  test: { environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'] },
})

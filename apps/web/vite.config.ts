/// <reference types="vitest/config" />
import { existsSync } from 'node:fs'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { sourceConditions } from '../../vitest.shared.ts'

// api와 같은 루트 .env를 읽는다 (프록시 포트가 api 포트와 어긋나지 않게). 이미 있는 환경 변수가 우선
const rootEnv = path.resolve(import.meta.dirname, '../../.env')
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv)
const apiPort = process.env.API_PORT ?? '3000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  ...sourceConditions,
  resolve: {
    ...sourceConditions.resolve,
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  // /api는 같은 출처로 프록시 — 세션 쿠키(SameSite=Lax)와 OIDC 콜백 주소가 앱 주소 하나로 맞는다
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: `http://localhost:${apiPort}`, changeOrigin: false } },
  },
  preview: { port: 5173, strictPort: true, proxy: { '/api': `http://localhost:${apiPort}` } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
})

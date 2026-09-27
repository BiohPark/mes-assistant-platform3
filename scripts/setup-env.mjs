// .env.example → .env 복사 (이미 있으면 그대로 둔다). OS 무관.
import { copyFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const target = resolve(root, '.env')
if (existsSync(target)) {
  console.log('.env가 이미 있습니다 — 건드리지 않습니다.')
} else {
  copyFileSync(resolve(root, '.env.example'), target)
  console.log('.env.example → .env 복사했습니다.')
}

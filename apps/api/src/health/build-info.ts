import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export type BuildInfo = { version: string; commit: string; builtAt: string }

export function buildInfo(): BuildInfo {
  try { return JSON.parse(readFileSync(resolve(import.meta.dirname, '../build-info.json'), 'utf8')) as BuildInfo }
  catch { return { version: 'development', commit: 'unknown', builtAt: '' } }
}

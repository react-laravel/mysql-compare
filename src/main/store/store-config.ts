import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { isElectronRuntime } from '../platform/electron-runtime'

const DEFAULT_WEB_DATA_DIR = join(homedir(), '.mysql-compare-web')

function resolveStoreDirectory(): string | undefined {
  if (isElectronRuntime()) return undefined

  const configured = process.env['MYSQL_COMPARE_DATA_DIR']?.trim()
  const directory = configured || DEFAULT_WEB_DATA_DIR
  mkdirSync(directory, { recursive: true })
  return directory
}

export function createStoreOptions<T extends Record<string, any>>(
  name: string,
  defaults: T
): { name: string; defaults: T; cwd?: string } {
  const cwd = resolveStoreDirectory()
  return cwd ? { name, defaults, cwd } : { name, defaults }
}

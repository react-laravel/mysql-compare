import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

interface StoreOptions<T extends Record<string, any>> {
  name?: string
  defaults: T
  cwd?: string
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export class SimpleJsonStore<T extends Record<string, any>> {
  private readonly filePath: string
  private data: T

  constructor(options: StoreOptions<T>) {
    const cwd = options.cwd || join(homedir(), '.config', 'mysql-compare')
    const name = options.name || 'config'
    this.filePath = join(cwd, `${name}.json`)
    this.data = clone(options.defaults)
    this.load()
  }

  get<K extends keyof T>(key: K): T[K] {
    return this.data[key]
  }

  set<K extends keyof T>(key: K, value: T[K]): void {
    this.data[key] = value
    this.save()
  }

  private load(): void {
    if (!existsSync(this.filePath)) {
      this.save()
      return
    }

    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<T>
      this.data = { ...this.data, ...parsed }
    } catch (error) {
      console.error(`[simple-json-store] Failed to read ${this.filePath}`, error)
      this.save()
    }
  }

  private save(): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2))
  }
}

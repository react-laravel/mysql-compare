import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('desktop IPC permissions', () => {
  it('allows every registered application command in the main window', () => {
    const commands = readFileSync('src-tauri/src/lib.rs', 'utf8')
    const permissions = readFileSync('src-tauri/permissions/allow-commands.toml', 'utf8')
    const capability = JSON.parse(readFileSync('src-tauri/capabilities/default.json', 'utf8'))
    expect(capability.windows).toContain('main')
    expect(capability.permissions).toContain('allow-commands')
    const registered = [...commands.matchAll(/commands::\w+::(\w+),/g)].map((match) => match[1])
    const allowed = new Set([...permissions.matchAll(/"(\w+)"/g)].map((match) => match[1]))
    expect(registered.length).toBeGreaterThan(0)
    expect(registered.filter((command) => !allowed.has(command))).toEqual([])
  })
})

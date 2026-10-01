import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const config = JSON.parse(readFileSync(new URL('../../../src-tauri/tauri.conf.json', import.meta.url), 'utf8'))
const capability = JSON.parse(readFileSync(new URL('../../../src-tauri/capabilities/default.json', import.meta.url), 'utf8'))
function directives(policy: string): Map<string, string[]> {
  return new Map(policy.split(';').filter((part) => part.trim()).map((part) => {
    const [name, ...sources] = part.trim().split(/\s+/)
    if (!name) throw new Error('CSP directive name is required')
    return [name, sources] as [string, string[]]
  }))
}

describe('production native security configuration', () => {
  it('limits connections to the app origin and Tauri IPC instead of arbitrary local services', () => {
    const csp = directives(config.app.security.csp)
    expect(csp.get('connect-src')).toEqual(["'self'", 'ipc:', 'http://ipc.localhost'])
    expect(csp.get('default-src')).toEqual(["'self'"])
    expect(csp.get('object-src')).toEqual(["'none'"])
    expect(csp.get('frame-src')).toEqual(["'none'"])
  })
  it('disallows inline and evaluated scripts while allowing local Monaco workers', () => {
    const csp = directives(config.app.security.csp)
    expect(csp.get('script-src')).toEqual(["'self'"])
    expect(csp.get('worker-src')).toEqual(["'self'", 'blob:'])
    const monaco = readFileSync(new URL('../monaco.ts', import.meta.url), 'utf8')
    expect(monaco).toContain("'monaco-editor/esm/vs/editor/editor.worker?worker'")
    expect(monaco).toContain('loader.config({ monaco })')
    expect(monaco).not.toMatch(/https?:\/\//)
  })
  it('keeps local file pickers backend owned and removes alternate filesystem access', () => {
    expect(capability.permissions).toContain('allow-commands')
    for (const forbidden of ['dialog:default', 'dialog:allow-open', 'dialog:allow-save', 'fs:default', 'fs:allow-read-file', 'fs:allow-write-file']) {
      expect(capability.permissions).not.toContain(forbidden)
    }
    const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8')
    expect(html).not.toMatch(/http-equiv=["']Content-Security-Policy["']/i)
  })
})

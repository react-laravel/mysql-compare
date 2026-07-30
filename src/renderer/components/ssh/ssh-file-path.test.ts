import { describe, expect, it } from 'vitest'
import { buildSSHRemotePath, getSSHBreadcrumbSegments } from './ssh-file-path'

describe('ssh-file-path', () => {
  it('builds clickable absolute and relative breadcrumbs', () => {
    expect(getSSHBreadcrumbSegments('/var/www')).toEqual([
      { label: '/', path: '/' },
      { label: 'var', path: '/var' },
      { label: 'www', path: '/var/www' }
    ])
    expect(getSSHBreadcrumbSegments('.')).toEqual([{ label: '.', path: '.' }])
    expect(getSSHBreadcrumbSegments('storage/logs')).toEqual([
      { label: 'storage', path: 'storage' },
      { label: 'logs', path: 'storage/logs' }
    ])
  })

  it('joins remote paths without duplicate separators', () => {
    expect(buildSSHRemotePath('/', 'app')).toBe('/app')
    expect(buildSSHRemotePath('.', 'app')).toBe('app')
    expect(buildSSHRemotePath('/var/www', 'app')).toBe('/var/www/app')
    expect(buildSSHRemotePath('/var/www/', 'app')).toBe('/var/www/app')
  })
})

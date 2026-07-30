export interface SSHBreadcrumbSegment {
  label: string
  path: string
}

/** `/var/www/app` → clickable `[/, var, www, app]` segments. */
export function getSSHBreadcrumbSegments(path: string): SSHBreadcrumbSegment[] {
  if (path === '.' || path === '') return [{ label: '.', path: '.' }]

  const parts = path.split('/').filter(Boolean)
  const absolute = path.startsWith('/')
  const segments: SSHBreadcrumbSegment[] = absolute ? [{ label: '/', path: '/' }] : []
  let prefix = absolute ? '' : '.'

  for (const part of parts) {
    prefix = prefix === '.' ? part : `${prefix}/${part}`
    segments.push({ label: part, path: prefix })
  }

  return segments
}

export function buildSSHRemotePath(directory: string, name: string): string {
  if (directory === '/') return `/${name}`
  if (directory === '.') return name
  return directory.endsWith('/') ? `${directory}${name}` : `${directory}/${name}`
}

export function hasDraggedFiles(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types ?? []).includes('Files')
}

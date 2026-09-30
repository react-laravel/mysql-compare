/** Legacy public table names stay unchanged. NUL cannot occur in PostgreSQL
 * identifiers, so this reserved prefix makes scoped keys collision-free.
 * Keep keys in API/state; use tableDisplayName at presentation boundaries. */
export function tableReference(table: string): { schema: string; name: string } {
  if (table.startsWith('\0')) {
    try {
      const parts: unknown = JSON.parse(table.slice(1))
      if (Array.isArray(parts) && parts.length === 2 && parts.every((part) => typeof part === 'string' && part.length > 0 && !part.includes('\0'))) {
        return { schema: parts[0] as string, name: parts[1] as string }
      }
    } catch { /* invalid keys are rejected by the database boundary */ }
  }
  return { schema: 'public', name: table }
}

export function tableKey(schema: string, name: string): string {
  return schema === 'public' ? name : `\0${JSON.stringify([schema, name])}`
}

export function tableDisplayName(table: string): string {
  const { schema, name } = tableReference(table)
  return schema === 'public' ? name : `${schema}.${name}`
}

export function renamedTableKey(table: string, name: string): string {
  return tableKey(tableReference(table).schema, name)
}

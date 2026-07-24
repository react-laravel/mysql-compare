/** Foreign-key edge: `fromTable` references `toTable` (from depends on to). */
export interface ForeignKeyEdge {
  fromTable: string
  toTable: string
}

/**
 * Stable topological order for sync: referenced/parent tables first, then dependents.
 * Cycles fall back to the original relative order for remaining nodes.
 */
export function orderTablesByForeignKeys(
  tables: readonly string[],
  edges: readonly ForeignKeyEdge[]
): string[] {
  const selected = new Set(tables)
  if (tables.length <= 1 || edges.length === 0) return [...tables]

  const indegree = new Map<string, number>()
  const dependents = new Map<string, string[]>()
  for (const table of tables) {
    indegree.set(table, 0)
    dependents.set(table, [])
  }

  for (const edge of edges) {
    if (!selected.has(edge.fromTable) || !selected.has(edge.toTable)) continue
    if (edge.fromTable === edge.toTable) continue
    dependents.get(edge.toTable)!.push(edge.fromTable)
    indegree.set(edge.fromTable, (indegree.get(edge.fromTable) ?? 0) + 1)
  }

  const queue = tables.filter((table) => (indegree.get(table) ?? 0) === 0)
  const ordered: string[] = []

  while (queue.length > 0) {
    const table = queue.shift()!
    ordered.push(table)
    for (const dependent of dependents.get(table) ?? []) {
      const next = (indegree.get(dependent) ?? 0) - 1
      indegree.set(dependent, next)
      if (next === 0) queue.push(dependent)
    }
  }

  if (ordered.length === tables.length) return ordered

  // Cycle or unresolved remainder: append remaining tables in original order.
  const seen = new Set(ordered)
  for (const table of tables) {
    if (!seen.has(table)) ordered.push(table)
  }
  return ordered
}

import type {
  ExplainPlanMetric,
  ExplainPlanNode,
  ExplainSQLResult,
  SqlDbEngine
} from '../../../shared/types'

type UnknownRecord = Record<string, unknown>

export function prepareExplainTarget(sql: string): string {
  const trimmed = sql.trim().replace(/;\s*$/, '').trim()
  if (!trimmed) throw new Error('SQL is required')
  if (trimmed.includes(';')) throw new Error('Explain supports one statement at a time')
  if (/^explain\s+analyze\b/i.test(trimmed)) {
    throw new Error('EXPLAIN ANALYZE is not used because it executes the statement')
  }

  const withoutExplain = stripExistingExplain(trimmed)
  if (!/^(select|with|insert|update|delete|replace)\b/i.test(withoutExplain)) {
    throw new Error('Explain supports SELECT, WITH, INSERT, UPDATE, DELETE, and REPLACE statements')
  }
  return withoutExplain
}

export function rowsAndColumns(rows: Record<string, unknown>[]): {
  rows: Record<string, unknown>[]
  columns: string[]
} {
  return {
    rows,
    columns: Array.from(new Set(rows.flatMap((row) => Object.keys(row))))
  }
}

export function buildPostgresExplainResult(
  statement: string,
  planPayload: unknown,
  rows: Record<string, unknown>[]
): ExplainSQLResult {
  const rootPlan = readPostgresRootPlan(planPayload)
  const plan = rootPlan ? buildPostgresPlanNode(rootPlan, 'pg') : null
  const table = rowsAndColumns(rows)

  return {
    engine: 'postgres',
    statement,
    summary: rootPlan ? buildPostgresSummary(rootPlan) : [],
    plan,
    columns: table.columns,
    rows: table.rows,
    raw: planPayload
  }
}

export function buildMySQLExplainResult(
  statement: string,
  planPayload: unknown,
  rows: Record<string, unknown>[]
): ExplainSQLResult {
  const rootPlan = asRecord(planPayload)
  const queryBlock = asRecord(rootPlan?.['query_block'])
  const plan = queryBlock ? buildMySQLQueryBlockNode(queryBlock, 'mysql') : null
  const table = rowsAndColumns(rows)

  return {
    engine: 'mysql',
    statement,
    summary: queryBlock ? buildMySQLSummary(queryBlock) : [],
    plan,
    columns: table.columns,
    rows: table.rows,
    raw: planPayload
  }
}

export function buildPlainExplainResult(
  engine: SqlDbEngine,
  statement: string,
  rows: Record<string, unknown>[]
): ExplainSQLResult {
  const table = rowsAndColumns(rows)
  return {
    engine,
    statement,
    summary: [],
    plan: null,
    columns: table.columns,
    rows: table.rows
  }
}

function stripExistingExplain(sql: string): string {
  let next = sql.replace(/^explain\s+format\s*=\s*json\s+/i, '').trim()
  next = next.replace(/^explain\s*\([^)]*\)\s+/i, '').trim()
  next = next.replace(/^explain\s+/i, '').trim()
  return next
}

function readPostgresRootPlan(planPayload: unknown): UnknownRecord | null {
  if (!Array.isArray(planPayload)) return null
  const first = asRecord(planPayload[0])
  return asRecord(first?.['Plan'])
}

function buildPostgresPlanNode(plan: UnknownRecord, id: string): ExplainPlanNode {
  const childPlans = Array.isArray(plan['Plans']) ? plan['Plans'] : []
  const details = [plan['Relation Name'], plan['Alias'], plan['Join Type'], plan['Strategy']]
    .filter((value) => value !== undefined && value !== null && String(value).trim())
    .map(String)

  return {
    id,
    label: String(plan['Node Type'] ?? 'Plan'),
    detail: details.length > 0 ? details.join(' · ') : undefined,
    metrics: compactMetrics([
      metric('Startup Cost', plan['Startup Cost']),
      metric('Total Cost', plan['Total Cost']),
      metric('Plan Rows', plan['Plan Rows']),
      metric('Plan Width', plan['Plan Width'])
    ]),
    children: childPlans
      .map((child, index) => asRecord(child) ? buildPostgresPlanNode(asRecord(child)!, `${id}.${index}`) : null)
      .filter(isPlanNode)
  }
}

function buildPostgresSummary(plan: UnknownRecord): ExplainPlanMetric[] {
  return compactMetrics([
    metric('Node', plan['Node Type']),
    metric('Total Cost', plan['Total Cost']),
    metric('Rows', plan['Plan Rows']),
    metric('Width', plan['Plan Width'])
  ])
}

function buildMySQLQueryBlockNode(block: UnknownRecord, id: string): ExplainPlanNode {
  const children: ExplainPlanNode[] = []
  const table = asRecord(block['table'])
  if (table) children.push(buildMySQLTableNode(table, `${id}.table`))

  const nestedLoop = Array.isArray(block['nested_loop']) ? block['nested_loop'] : []
  nestedLoop.forEach((item, index) => {
    const child = buildMySQLChildNode(item, `${id}.loop.${index}`, 'Nested Loop')
    if (child) children.push(child)
  })

  for (const key of ['ordering_operation', 'grouping_operation', 'duplicates_removal', 'buffer_result', 'union_result']) {
    const child = buildMySQLChildNode(block[key], `${id}.${key}`, formatPlanLabel(key))
    if (child) children.push(child)
  }

  const attachedSubqueries = Array.isArray(block['attached_subqueries']) ? block['attached_subqueries'] : []
  attachedSubqueries.forEach((item, index) => {
    const child = buildMySQLChildNode(item, `${id}.subquery.${index}`, 'Attached Subquery')
    if (child) children.push(child)
  })

  return {
    id,
    label: `Query Block ${stringValue(block['select_id']) ?? ''}`.trim(),
    metrics: compactMetrics([
      metric('Select ID', block['select_id']),
      metric('Query Cost', asRecord(block['cost_info'])?.['query_cost'])
    ]),
    children
  }
}

function buildMySQLChildNode(value: unknown, id: string, label: string): ExplainPlanNode | null {
  const record = asRecord(value)
  if (!record) return null

  const table = asRecord(record['table'])
  if (table) return buildMySQLTableNode(table, id)

  const queryBlock = asRecord(record['query_block'])
  if (queryBlock) {
    const node = buildMySQLQueryBlockNode(queryBlock, id)
    return { ...node, label }
  }

  const children: ExplainPlanNode[] = []
  const nestedLoop = Array.isArray(record['nested_loop']) ? record['nested_loop'] : []
  nestedLoop.forEach((item, index) => {
    const child = buildMySQLChildNode(item, `${id}.${index}`, 'Nested Loop')
    if (child) children.push(child)
  })

  for (const key of ['ordering_operation', 'grouping_operation', 'duplicates_removal', 'buffer_result', 'union_result']) {
    const child = buildMySQLChildNode(record[key], `${id}.${key}`, formatPlanLabel(key))
    if (child) children.push(child)
  }

  return {
    id,
    label,
    metrics: compactMetrics([
      metric('Using Temporary Table', record['using_temporary_table']),
      metric('Using Filesort', record['using_filesort'])
    ]),
    children
  }
}

function buildMySQLTableNode(table: UnknownRecord, id: string): ExplainPlanNode {
  const costInfo = asRecord(table['cost_info'])
  const keyParts = Array.isArray(table['used_key_parts']) ? table['used_key_parts'].join(', ') : undefined
  const possibleKeys = Array.isArray(table['possible_keys']) ? table['possible_keys'].join(', ') : undefined

  return {
    id,
    label: `Table ${stringValue(table['table_name']) ?? 'unknown'}`,
    detail: stringValue(table['access_type']),
    metrics: compactMetrics([
      metric('Rows/Scan', table['rows_examined_per_scan']),
      metric('Rows Produced', table['rows_produced_per_join']),
      metric('Filtered', table['filtered'] !== undefined ? `${table['filtered']}%` : undefined),
      metric('Key', table['key']),
      metric('Key Parts', keyParts),
      metric('Possible Keys', possibleKeys),
      metric('Read Cost', costInfo?.['read_cost']),
      metric('Eval Cost', costInfo?.['eval_cost']),
      metric('Prefix Cost', costInfo?.['prefix_cost'])
    ]),
    children: []
  }
}

function buildMySQLSummary(block: UnknownRecord): ExplainPlanMetric[] {
  const costInfo = asRecord(block['cost_info'])
  return compactMetrics([
    metric('Select ID', block['select_id']),
    metric('Query Cost', costInfo?.['query_cost'])
  ])
}

function metric(label: string, value: unknown): ExplainPlanMetric | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
    return { label, value: String(value) }
  }
  return { label, value: JSON.stringify(value) }
}

function compactMetrics(metrics: Array<ExplainPlanMetric | null>): ExplainPlanMetric[] {
  return metrics.filter((item): item is ExplainPlanMetric => item !== null)
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null
}

function stringValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  return String(value)
}

function formatPlanLabel(key: string): string {
  return key
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function isPlanNode(value: ExplainPlanNode | null): value is ExplainPlanNode {
  return value !== null
}
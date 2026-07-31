import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

type DatabaseModule = typeof import('../apps/server/src/database.js')
type CopyBlock = { table: string; columns: string[]; rows: string[] }

const sourceArg = process.argv[2]
const targetArg = process.argv[3]
if (!sourceArg || !targetArg) throw new Error('usage: tsx scripts/restore-postgres-dump.ts <postgres.sql> <new-pglite-directory>')

const source = resolve(sourceArg)
const target = resolve(targetArg)
if (!existsSync(source)) throw new Error(`restore_source_not_found: ${source}`)
if (existsSync(target)) throw new Error(`restore_target_exists_refusing_overwrite: ${target}`)
mkdirSync(target, { recursive: true })

function parseCopyBlocks(sql: string): CopyBlock[] {
  const blocks: CopyBlock[] = []
  const pattern = /^COPY public\.([a-z0-9_]+) \(([^\n]+)\) FROM stdin;\r?\n([\s\S]*?)\r?\n\\\.$/gm
  for (const match of sql.matchAll(pattern)) {
    const table = match[1]
    const columnText = match[2]
    const rowText = match[3]
    if (!table || columnText === undefined || rowText === undefined) throw new Error('restore_copy_block_malformed')
    const columns = columnText.split(',').map(column => column.trim().replace(/^"|"$/g, ''))
    const rows = rowText.split(/\r?\n/).filter(Boolean)
    blocks.push({ table, columns, rows })
  }
  return blocks
}

function decodeCopyField(value: string): string | null {
  if (value === '\\N') return null
  let result = ''
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (character !== '\\') { result += character; continue }
    const escaped = value[++index]
    if (escaped === undefined) throw new Error('restore_copy_truncated_escape')
    const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '\\': '\\' }
    if (escapes[escaped] !== undefined) { result += escapes[escaped]; continue }
    if (/^[0-7]$/.test(escaped)) {
      let octal = escaped
      for (let count = 0; count < 2 && /^[0-7]$/.test(value[index + 1] || ''); count += 1) octal += value[++index]
      result += String.fromCharCode(parseInt(octal, 8)); continue
    }
    result += escaped
  }
  return result
}

function decodeCopyRow(row: string): Array<string | null> {
  return row.split('\t').map(decodeCopyField)
}

const importOrder = [
  'projects', 'conversation_sessions', 'idea_versions', 'papers', 'proposals', 'experiments',
  'artifacts', 'artifact_dependencies', 'evidence', 'messages', 'policies', 'audit_events',
  'reports', 'repositories', 'tasks', 'uploaded_files', 'human_feedback', 'checkpoints',
]
const columnAliases: Record<string, string> = { mlflow_run_id: 'run_id' }

const sql = readFileSync(source, 'utf8')
const blocks = parseCopyBlocks(sql)
const blockByTable = new Map(blocks.map(block => [block.table, block]))
if (blocks.length === 0) throw new Error('restore_no_public_copy_blocks')

process.env.RESEARCH_RUNTIME_DIR = target
const databaseModule: DatabaseModule = await import('../apps/server/src/database.js')
const { database, migrate } = databaseModule

try {
  await migrate()
  const imported: Record<string, number> = {}
  for (const table of importOrder) {
    const block = blockByTable.get(table)
    if (!block || block.rows.length === 0) { imported[table] = 0; continue }
    const columns = await database.query<{ column_name: string; data_type: string }>(
      'SELECT column_name, data_type FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2',
      ['public', table],
    )
    const currentColumns = new Map(columns.rows.map(row => [row.column_name, row.data_type]))
    const mappings = block.columns.map((column, index) => ({ old: column, current: columnAliases[column] || column, index, dataType: currentColumns.get(columnAliases[column] || column) }))
      .filter((mapping): mapping is typeof mapping & { dataType: string } => mapping.dataType !== undefined)
    if (mappings.length === 0) throw new Error(`restore_table_has_no_compatible_columns: ${table}`)
    const quotedColumns = mappings.map(mapping => `"${mapping.current.replaceAll('"', '""')}"`).join(',')
    const placeholders = mappings.map((_, index) => `$${index + 1}`).join(',')
    const statement = `INSERT INTO "${table}" (${quotedColumns}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`
    let count = 0
    for (const row of block.rows) {
      const values = decodeCopyRow(row)
      await database.query(statement, mappings.map(mapping => convertValue(values[mapping.index], mapping.dataType)))
      count += 1
    }
    imported[table] = count
    console.log(`restored ${table}: ${count}`)
  }
  const checks = await Promise.all(['projects', 'experiments', 'artifacts', 'messages', 'tasks'].map(async table => {
    const result = await database.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM "${table}"`)
    return [table, Number(result.rows[0]?.count || 0)] as const
  }))
  const summary = Object.fromEntries(checks)
  if (summary.projects !== imported.projects || summary.experiments !== imported.experiments || summary.artifacts !== imported.artifacts || summary.messages !== imported.messages || summary.tasks !== imported.tasks) {
    throw new Error(`restore_row_count_mismatch: ${JSON.stringify({ imported, summary })}`)
  }
  console.log(JSON.stringify({ source, target, imported, summary }))
} finally {
  await database.close()
}

function convertValue(value: string | null | undefined, dataType: string): string | boolean | number | null {
  if (value === null || value === undefined) return null
  if (dataType === 'boolean') {
    if (value === 't' || value === 'true' || value === '1') return true
    if (value === 'f' || value === 'false' || value === '0') return false
    throw new Error(`restore_invalid_boolean: ${value}`)
  }
  return value
}

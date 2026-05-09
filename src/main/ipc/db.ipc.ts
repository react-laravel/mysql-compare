import { IPC } from '../../shared/ipc-channels'
import type {
  CopyTableRequest,
  DatabaseInfo,
  DeleteRowsRequest,
  DropDatabaseRequest,
  DropTableRequest,
  ExplainSQLRequest,
  ExplainSQLResult,
  ExportDatabaseRequest,
  ExportDatabaseResult,
  ExportTableRequest,
  ExportTableResult,
  ImportTableRequest,
  ImportTableResult,
  InsertRowRequest,
  QueryRowsRequest,
  QueryRowsResult,
  RenameTableRequest,
  TruncateTableRequest,
  UpdateRowRequest
} from '../../shared/types'
import { dbService } from '../services/db-service'
import { exportService } from '../services/export-service'
import { importService } from '../services/import-service'
import { schemaService } from '../services/schema-service'
import { handle } from './_wrap'

export function registerDbIPC(): void {
  handle(IPC.ListDatabases, async ({ connectionId }: { connectionId: string }) => {
    const driver = await dbService.getDriver(connectionId)
    return driver.listDatabases()
  })

  handle(
    IPC.GetDatabaseInfo,
    async ({ connectionId, database }: { connectionId: string; database: string }): Promise<DatabaseInfo> => {
      const driver = await dbService.getDriver(connectionId)
      return driver.getDatabaseInfo(database)
    }
  )

  handle(
    IPC.ListTables,
    async ({ connectionId, database }: { connectionId: string; database: string }) => {
      const driver = await dbService.getDriver(connectionId)
      return driver.listTables(database)
    }
  )

  handle(IPC.QueryRows, async (req: QueryRowsRequest): Promise<QueryRowsResult> => {
    const driver = await dbService.getDriver(req.connectionId)
    const schema = await schemaService.getTableSchema(req.connectionId, req.database, req.table)
    if (req.orderBy && !schema.columns.some((column) => column.name === req.orderBy?.column)) {
      throw new Error(`Unknown sort column "${req.orderBy.column}"`)
    }
    const { rows, total } = await driver.queryRows(req)
    return {
      rows,
      total,
      hasPrimaryKey: schema.primaryKey.length > 0,
      primaryKey: schema.primaryKey,
      columns: schema.columns
    }
  })

  handle(IPC.InsertRow, async (req: InsertRowRequest) => {
    const driver = await dbService.getDriver(req.connectionId)
    return driver.insertRow(req)
  })
  handle(IPC.UpdateRow, async (req: UpdateRowRequest) => {
    const driver = await dbService.getDriver(req.connectionId)
    return driver.updateRow(req)
  })
  handle(IPC.DeleteRows, async (req: DeleteRowsRequest) => {
    const driver = await dbService.getDriver(req.connectionId)
    return driver.deleteRows(req)
  })
  handle(IPC.RenameTable, async (req: RenameTableRequest) => {
    const driver = await dbService.getDriver(req.connectionId)
    return driver.renameTable(req)
  })
  handle(IPC.CopyTable, async (req: CopyTableRequest) => {
    const driver = await dbService.getDriver(req.connectionId)
    return driver.copyTable(req)
  })
  handle(IPC.DropDatabase, async (req: DropDatabaseRequest) => {
    const driver = await dbService.getDriver(req.connectionId)
    return driver.dropDatabase(req)
  })
  handle(IPC.DropTable, async (req: DropTableRequest) => {
    const driver = await dbService.getDriver(req.connectionId)
    return driver.dropTable(req)
  })
  handle(IPC.TruncateTable, async (req: TruncateTableRequest) => {
    const driver = await dbService.getDriver(req.connectionId)
    const tableScope = driver.engine === 'postgres' ? 'public' : req.database
    return driver.executeSQL(driver.dialect.renderTruncate(tableScope, req.table), req.database)
  })
  handle(
    IPC.ExportTable,
    (req: ExportTableRequest): Promise<ExportTableResult> => exportService.exportTable(req)
  )
  handle(
    IPC.ExportDatabase,
    (req: ExportDatabaseRequest): Promise<ExportDatabaseResult> => exportService.exportDatabase(req)
  )
  handle(
    IPC.ImportTable,
    (req: ImportTableRequest): Promise<ImportTableResult> => importService.importTable(req)
  )

  handle(
    IPC.ExecuteSQL,
    async ({
      connectionId,
      sql,
      database
    }: {
      connectionId: string
      sql: string
      database?: string
    }) => {
      const driver = await dbService.getDriver(connectionId)
      return driver.executeSQL(sql, database)
    }
  )

  handle(IPC.ExplainSQL, async (req: ExplainSQLRequest): Promise<ExplainSQLResult> => {
    const driver = await dbService.getDriver(req.connectionId)
    return driver.explainSQL(req.sql, req.database)
  })
}

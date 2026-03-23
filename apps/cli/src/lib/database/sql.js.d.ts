/**
 * Type declarations for sql.js (WASM-based SQLite).
 * sql.js doesn't ship TypeScript types, so we declare them here.
 */
declare module 'sql.js' {
  export type SqlValue = number | string | Uint8Array | null
  export type ParamsObject = Record<string, SqlValue>
  export type ParamsCallback = (obj: ParamsObject) => void
  export type BindParams = SqlValue[] | ParamsObject | null

  export interface QueryExecResult {
    columns: string[]
    values: SqlValue[][]
  }

  export interface SqlJsStatic {
    Database: typeof Database
  }

  export class Database {
    constructor()
    constructor(data?: ArrayLike<number> | Buffer | null)

    run(sql: string, params?: BindParams): Database
    exec(sql: string, params?: BindParams): QueryExecResult[]
    each(sql: string, params: BindParams, callback: ParamsCallback, done: () => void): Database
    each(sql: string, callback: ParamsCallback, done: () => void): Database
    prepare(sql: string, params?: BindParams): Statement
    export(): Uint8Array
    close(): void
    getRowsModified(): number
    create_function(name: string, func: (...args: any[]) => any): Database
    create_aggregate(
      name: string,
      functions: {
        init: () => any
        step: (state: any, ...args: any[]) => any
        finalize: (state: any) => any
      },
    ): Database
  }

  export class Statement {
    bind(params?: BindParams): boolean
    step(): boolean
    getAsObject(params?: BindParams): ParamsObject
    get(params?: BindParams): SqlValue[]
    getColumnNames(): string[]
    free(): boolean
    reset(): void
    run(params?: BindParams): void
  }

  export interface SqlJsConfig {
    locateFile?: (filename: string) => string
    wasmBinary?: ArrayLike<number>
  }

  export default function initSqlJs(config?: SqlJsConfig): Promise<SqlJsStatic>
}

/**
 * `good7ob schema import` — load a live-database export (see exportSql) into Forge DB Schema Design
 * (/forge/schema/modules → tables → columns). Idempotent: creates what is missing, updates what
 * changed, never deletes.
 */
/** psql query that prints one JSON document describing every table/column of `dbSchema` (run with `psql -At`). */
export declare function exportSql(dbSchema: string): string;
export interface ExportColumn {
    name: string;
    type: string;
    nullable: boolean;
    default: string | null;
    pk: boolean;
    fkTable: string | null;
    fkColumn: string | null;
    comment: string | null;
}
export interface ExportTable {
    name: string;
    comment: string | null;
    columns: ExportColumn[];
}
export interface SchemaExport {
    schema: string;
    tables: ExportTable[];
}
/** Validate the export file at the trust boundary; returns it typed. */
export declare function parseExport(raw: unknown): SchemaExport;
/** Table-name prefix → design module. A table matches `key` exactly or `key_…`; first match wins, so longer keys go first. */
export declare const MODULES: {
    key: string;
    name: string;
}[];
export declare const OTHER_MODULE = "\u5176\u4ED6";
export declare function moduleFor(table: string): {
    key: string;
    name: string;
};
export interface DesiredColumn {
    columnName: string;
    dataType: string;
    nullable: boolean;
    defaultVal: string | null;
    isPk: boolean;
    isFk: boolean;
    fkRefTable: string | null;
    fkRefColumn: string | null;
    description: string;
    sortOrder: number;
}
export interface DesiredTable {
    tableName: string;
    description: string;
    status: 'published';
    sortOrder: number;
    columns: DesiredColumn[];
}
export interface DesiredModule {
    name: string;
    prefix: string;
    description: string;
    sortOrder: number;
    tables: DesiredTable[];
}
/** `pm_task` + `pm_tasks` both existing → each is flagged as a suspected duplicate of the other. */
export declare function duplicateNotes(names: string[]): Map<string, string>;
/** Column widths from backend V165; anything longer makes the insert 500, so clip at the boundary. */
export declare const LIMITS: {
    prefix: number;
    description: number;
    dataType: number;
    defaultVal: number;
};
export declare const clip: (v: string, max: number) => string;
export declare function buildDesired(doc: SchemaExport): DesiredModule[];
export interface SchemaClient {
    get(url: string, params?: Record<string, any>): Promise<any>;
    post(url: string, body?: any): Promise<any>;
    put(url: string, body?: any): Promise<any>;
}
export type Layer = 'module' | 'table' | 'column';
export interface SchemaAction {
    layer: Layer;
    op: 'create' | 'update';
    id: string;
    fields?: string[];
}
export interface SchemaSyncResult {
    counts: Record<Layer, {
        create: number;
        update: number;
        unchanged: number;
    }>;
    actions: SchemaAction[];
    /** Tables already registered under another module: unique per org and the API can't move them, so they are skipped. */
    conflicts: string[];
}
/** Fields of `want` whose value differs from `row` (null, undefined and '' compare equal). */
export declare function changedFields(row: any, want: Record<string, unknown>, keys: string[]): string[];
export declare function syncSchema(client: SchemaClient, orgId: number, modules: DesiredModule[], opts: {
    dryRun: boolean;
    concurrency: number;
    retryDelaysMs?: number[];
}): Promise<SchemaSyncResult>;
//# sourceMappingURL=schemaImport.d.ts.map
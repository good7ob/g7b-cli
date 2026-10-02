"use strict";
/**
 * `good7ob schema import` — load a live-database export (see exportSql) into Forge DB Schema Design
 * (/forge/schema/modules → tables → columns). Idempotent: creates what is missing, updates what
 * changed, never deletes.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncSchema = exports.changedFields = exports.buildDesired = exports.clip = exports.LIMITS = exports.duplicateNotes = exports.moduleFor = exports.OTHER_MODULE = exports.MODULES = exports.parseExport = exports.exportSql = void 0;
const pool_1 = require("../../utils/pool");
// ── export ───────────────────────────────────────────────────────────────
const SCHEMA_NAME = /^[a-z_][a-z0-9_]*$/;
/** psql query that prints one JSON document describing every table/column of `dbSchema` (run with `psql -At`). */
function exportSql(dbSchema) {
    if (!SCHEMA_NAME.test(dbSchema))
        throw new Error(`schema 名不合法: ${dbSchema}`);
    return `WITH cols AS (
  SELECT c.oid, c.relname AS table_name,
         json_agg(json_build_object(
           'name', a.attname,
           'type', format_type(a.atttypid, a.atttypmod),
           'nullable', NOT a.attnotnull,
           'default', pg_get_expr(d.adbin, d.adrelid),
           'pk', EXISTS (SELECT 1 FROM pg_constraint p
                         WHERE p.conrelid = c.oid AND p.contype = 'p' AND a.attnum = ANY (p.conkey)),
           'fkTable', fk.ref_table,
           'fkColumn', fk.ref_column,
           'comment', col_description(c.oid, a.attnum)
         ) ORDER BY a.attnum) AS columns
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
  LEFT JOIN LATERAL (
    SELECT rc.relname AS ref_table, ra.attname AS ref_column
    FROM pg_constraint f
    JOIN pg_class rc ON rc.oid = f.confrelid
    JOIN pg_attribute ra ON ra.attrelid = f.confrelid
                        AND ra.attnum = f.confkey[array_position(f.conkey, a.attnum)]
    WHERE f.conrelid = c.oid AND f.contype = 'f' AND a.attnum = ANY (f.conkey)
    LIMIT 1
  ) fk ON true
  WHERE n.nspname = '${dbSchema}' AND c.relkind IN ('r', 'p') AND c.relname <> 'flyway_schema_history'
  GROUP BY c.oid, c.relname
)
SELECT json_build_object(
  'schema', '${dbSchema}',
  'tables', coalesce(json_agg(json_build_object(
    'name', table_name, 'comment', obj_description(oid, 'pg_class'), 'columns', columns
  ) ORDER BY table_name), '[]'::json))
FROM cols;
`;
}
exports.exportSql = exportSql;
/** Validate the export file at the trust boundary; returns it typed. */
function parseExport(raw) {
    const doc = raw;
    if (!doc || typeof doc.schema !== 'string' || !Array.isArray(doc.tables)) {
        throw new Error('导出文件格式不对：需要 { schema, tables: [...] }，请用 `good7ob schema export-sql` 生成');
    }
    doc.tables.forEach((t, i) => {
        if (!t || typeof t.name !== 'string' || !t.name || !Array.isArray(t.columns)) {
            throw new Error(`tables[${i}] 缺少 name 或 columns`);
        }
        t.columns.forEach((c, j) => {
            if (!c || typeof c.name !== 'string' || !c.name)
                throw new Error(`${t.name}.columns[${j}] 缺少 name`);
        });
    });
    return doc;
}
exports.parseExport = parseExport;
// ── plan ─────────────────────────────────────────────────────────────────
/** Table-name prefix → design module. A table matches `key` exactly or `key_…`; first match wins, so longer keys go first. */
exports.MODULES = [
    { key: 'personal_secretary', name: '秘书助手' },
    { key: 'forge', name: 'Forge（AI 开发工具）' },
    { key: 'pm', name: '项目管理' },
    { key: 'order', name: '订单' },
    { key: 'pay', name: '支付' },
    { key: 'org', name: '组织' },
    { key: 'iam', name: '用户认证' },
    { key: 'sys', name: '系统' },
    { key: 'kb', name: '知识库' },
    { key: 'qc', name: '质量控制' },
    { key: 'tpl', name: '模板中心' },
    { key: 'infra', name: '基础设施成本' },
    { key: 'chat', name: '聊天' },
    { key: 'blog', name: '博客' },
    { key: 'mall', name: '商城' },
    { key: 'mkt', name: '市场' },
    { key: 'msg', name: '消息' },
    { key: 'stat', name: '统计' },
    { key: 'ad', name: '广告' },
    { key: 'contract', name: '合同' },
    { key: 'project', name: '项目（旧）' },
    { key: 'user', name: '用户（旧命名）' },
    { key: 'ms', name: 'MS 管理端' },
    { key: 'guide', name: '新手引导' },
    { key: 'token', name: 'Token 充值' },
    { key: 'privilege', name: '权限' },
    { key: 'cases', name: '案件' },
    { key: 't', name: '迁移遗留（t_）' },
];
exports.OTHER_MODULE = '其他';
function moduleFor(table) {
    return exports.MODULES.find((m) => table === m.key || table.startsWith(`${m.key}_`)) ?? { key: '', name: exports.OTHER_MODULE };
}
exports.moduleFor = moduleFor;
/** `pm_task` + `pm_tasks` both existing → each is flagged as a suspected duplicate of the other. */
function duplicateNotes(names) {
    const all = new Set(names);
    const notes = new Map();
    names.forEach((n) => {
        const singular = n.endsWith('s') ? n.slice(0, -1) : '';
        if (singular && all.has(singular)) {
            notes.set(n, `疑似重复：与 ${singular} 并存`);
            notes.set(singular, `疑似重复：与 ${n} 并存`);
        }
    });
    return notes;
}
exports.duplicateNotes = duplicateNotes;
const joinNote = (...parts) => parts.filter((p) => p && p.trim()).join('；');
/** Column widths from backend V165; anything longer makes the insert 500, so clip at the boundary. */
exports.LIMITS = { prefix: 16, description: 512, dataType: 64, defaultVal: 255 };
const clip = (v, max) => (v.length > max ? v.slice(0, max) : v);
exports.clip = clip;
function buildDesired(doc) {
    const notes = duplicateNotes(doc.tables.map((t) => t.name));
    const byModule = new Map();
    const order = [...exports.MODULES.map((m) => m.name), exports.OTHER_MODULE];
    [...doc.tables].sort((a, b) => a.name.localeCompare(b.name)).forEach((t) => {
        const m = moduleFor(t.name);
        if (!byModule.has(m.name)) {
            byModule.set(m.name, {
                name: m.name,
                prefix: (0, exports.clip)(m.key ? `${m.key}_` : '', exports.LIMITS.prefix),
                description: `从 ${doc.schema} 实库导入，按表名前缀${m.key ? ` ${m.key}_` : '（无匹配）'}归类`,
                sortOrder: order.indexOf(m.name),
                tables: [],
            });
        }
        const mod = byModule.get(m.name);
        mod.tables.push({
            tableName: t.name,
            description: (0, exports.clip)(joinNote(t.comment, notes.get(t.name)), exports.LIMITS.description),
            status: 'published',
            sortOrder: mod.tables.length,
            columns: t.columns.map((c, i) => ({
                columnName: c.name,
                dataType: (0, exports.clip)(c.type || 'unknown', exports.LIMITS.dataType),
                nullable: c.nullable !== false,
                defaultVal: c.default == null ? null : (0, exports.clip)(c.default, exports.LIMITS.defaultVal),
                isPk: c.pk === true,
                isFk: !!c.fkTable,
                fkRefTable: c.fkTable ?? null,
                fkRefColumn: c.fkColumn ?? null,
                description: (0, exports.clip)(c.comment ?? '', exports.LIMITS.description),
                sortOrder: i,
            })),
        });
    });
    return [...byModule.values()].sort((a, b) => a.sortOrder - b.sortOrder);
}
exports.buildDesired = buildDesired;
const norm = (v) => (v === undefined || v === null ? '' : String(v));
/** Fields of `want` whose value differs from `row` (null, undefined and '' compare equal). */
function changedFields(row, want, keys) {
    return keys.filter((k) => norm(row?.[k]) !== norm(want[k]));
}
exports.changedFields = changedFields;
const MODULE_KEYS = ['prefix', 'description'];
const TABLE_KEYS = ['description', 'status', 'sortOrder'];
const COLUMN_KEYS = ['dataType', 'nullable', 'defaultVal', 'isPk', 'isFk', 'fkRefTable', 'fkRefColumn', 'description', 'sortOrder'];
async function syncSchema(client, orgId, modules, opts) {
    const zero = () => ({ create: 0, update: 0, unchanged: 0 });
    const result = { counts: { module: zero(), table: zero(), column: zero() }, actions: [], conflicts: [] };
    const record = (layer, op, id, fields) => {
        result.counts[layer][op] += 1;
        if (op !== 'unchanged')
            result.actions.push({ layer, op, id, ...(fields ? { fields } : {}) });
    };
    const at = (0, pool_1.rateLimitRetry)(opts.retryDelaysMs);
    const syncColumns = async (tableRow, table, existing) => {
        const byName = new Map(existing.map((c) => [c.columnName, c]));
        for (const col of table.columns) {
            const id = `${table.tableName}.${col.columnName}`;
            const row = byName.get(col.columnName);
            if (!row) {
                record('column', 'create', id);
                if (!opts.dryRun)
                    await at(id, () => client.post(`/forge/schema/tables/${tableRow.id}/columns`, col));
                continue;
            }
            const diff = changedFields(row, col, COLUMN_KEYS);
            if (!diff.length) {
                record('column', 'unchanged', id);
                continue;
            }
            record('column', 'update', id, diff);
            if (!opts.dryRun)
                await at(id, () => client.put(`/forge/schema/columns/${row.id}`, col));
        }
    };
    try {
        const existingModules = new Map(((await at(`org ${orgId}`, () => client.get('/forge/schema/modules', { orgId }))) ?? []).map((m) => [m.name, m]));
        // Table names are unique per org, so index every existing table with the module it lives in.
        const existingTables = new Map();
        for (const m of existingModules.values()) {
            const rows = (await at(`module ${m.name}`, () => client.get(`/forge/schema/modules/${m.id}/tables`))) ?? [];
            rows.forEach((row) => existingTables.set(row.tableName, { row, moduleName: m.name }));
        }
        const work = [];
        for (const mod of modules) {
            const body = { orgId, name: mod.name, prefix: mod.prefix, description: mod.description, sortOrder: mod.sortOrder };
            let moduleRow = existingModules.get(mod.name);
            if (!moduleRow) {
                record('module', 'create', mod.name);
                if (!opts.dryRun)
                    moduleRow = await at(mod.name, () => client.post('/forge/schema/modules', body));
            }
            else {
                const diff = changedFields(moduleRow, body, MODULE_KEYS);
                if (!diff.length)
                    record('module', 'unchanged', mod.name);
                else {
                    record('module', 'update', mod.name, diff);
                    if (!opts.dryRun)
                        await at(mod.name, () => client.put(`/forge/schema/modules/${moduleRow.id}`, body));
                }
            }
            mod.tables.forEach((table) => work.push({ moduleRow, table }));
        }
        await (0, pool_1.runPool)(work, opts.concurrency, async ({ moduleRow, table }) => {
            const found = existingTables.get(table.tableName);
            const body = { tableName: table.tableName, description: table.description, status: table.status, sortOrder: table.sortOrder };
            if (found && found.row.moduleId !== moduleRow?.id) {
                result.conflicts.push(`${table.tableName}（已在模块「${found.moduleName}」下）`);
                return;
            }
            if (!found) {
                record('table', 'create', table.tableName);
                let created = null;
                if (!opts.dryRun) {
                    created = await at(table.tableName, () => client.post(`/forge/schema/modules/${moduleRow.id}/tables`, body));
                }
                await syncColumns(created, table, []);
                return;
            }
            const diff = changedFields(found.row, body, TABLE_KEYS);
            if (!diff.length)
                record('table', 'unchanged', table.tableName);
            else {
                record('table', 'update', table.tableName, diff);
                if (!opts.dryRun)
                    await at(table.tableName, () => client.put(`/forge/schema/tables/${found.row.id}`, body));
            }
            const cols = (await at(table.tableName, () => client.get(`/forge/schema/tables/${found.row.id}/columns`))) ?? [];
            await syncColumns(found.row, table, cols);
        });
    }
    catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        err.partial = result;
        throw err;
    }
    return result;
}
exports.syncSchema = syncSchema;
//# sourceMappingURL=schemaImport.js.map
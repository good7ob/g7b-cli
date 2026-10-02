"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSchemaCommands = void 0;
const fs_1 = __importDefault(require("fs"));
const ApiClient_1 = __importDefault(require("../../services/ApiClient"));
const cliHelpers_1 = require("../../utils/cliHelpers");
const schemaImport_1 = require("./schemaImport");
const LAYER_CN = { module: '模块', table: '表', column: '字段' };
const OP_ICON = { create: '＋', update: '↻' };
function printCounts(result) {
    console.log(`\n${''.padEnd(8)}${'新建'.padEnd(8)}${'更新'.padEnd(8)}不变`);
    Object.keys(result.counts).forEach((layer) => {
        const c = result.counts[layer];
        console.log(`${LAYER_CN[layer].padEnd(8)}${String(c.create).padEnd(10)}${String(c.update).padEnd(10)}${c.unchanged}`);
    });
}
function readExport(file) {
    let raw;
    try {
        raw = JSON.parse(fs_1.default.readFileSync(file, 'utf8'));
    }
    catch (e) {
        throw new cliHelpers_1.InputError(`无法读取 --file ${file}: ${e instanceof Error ? e.message : e}`);
    }
    return (0, schemaImport_1.parseExport)(raw);
}
function registerSchemaCommands(program) {
    const schema = program.command('schema').description('Forge DB Schema Design：数据库设计文档（模块 → 表 → 字段）');
    schema
        .command('export-sql')
        .description('打印导出实库表结构的 SQL；用 psql -At 执行，输出即 `schema import --file` 需要的 JSON')
        .option('--db-schema <name>', '要导出的 PostgreSQL schema', 'good7ob_dev')
        .action((o) => {
        try {
            process.stdout.write((0, schemaImport_1.exportSql)(o.dbSchema));
        }
        catch (e) {
            console.error('✗', e instanceof Error ? e.message : String(e));
            process.exit(1);
        }
    });
    schema
        .command('import')
        .description('把实库表结构幂等导入组织的 DB Schema Design（按表名前缀分模块；只新建/更新，不删除）')
        .option('--org <id>', '目标组织 ID（需 owner/admin 角色；--parse-only 可省略）')
        .requiredOption('--file <json>', '`schema export-sql | psql -At` 的输出文件')
        .option('--dry-run', '读取现有数据并打印计划，不写入')
        .option('--parse-only', '只解析本地文件并打印分组统计，不调用 API')
        .option('--concurrency <n>', '并发处理的表数', '4')
        .option('--verbose', '逐条打印新建/更新动作（字段级）')
        .option('--json', '输出 JSON')
        .action(async (o) => {
        try {
            const modules = (0, schemaImport_1.buildDesired)(readExport(o.file));
            const tableCount = modules.reduce((n, m) => n + m.tables.length, 0);
            const columnCount = modules.reduce((n, m) => n + m.tables.reduce((k, t) => k + t.columns.length, 0), 0);
            const parsed = { modules: modules.length, tables: tableCount, columns: columnCount };
            if (o.parseOnly) {
                if (o.json) {
                    console.log(JSON.stringify({ parsed, modules: modules.map((m) => ({ name: m.name, tables: m.tables.length })) }, null, 2));
                    return;
                }
                modules.forEach((m) => console.log(`${String(m.tables.length).padStart(4)}  ${m.name}`));
                console.log(`\n合计  模块 ${parsed.modules}   表 ${parsed.tables}   字段 ${parsed.columns}`);
                return;
            }
            const orgId = (0, cliHelpers_1.parseId)(o.org, '--org');
            const concurrency = (0, cliHelpers_1.parseId)(o.concurrency, '--concurrency');
            const result = await (0, schemaImport_1.syncSchema)(ApiClient_1.default, orgId, modules, { dryRun: !!o.dryRun, concurrency });
            if (o.json) {
                console.log(JSON.stringify({ parsed, dryRun: !!o.dryRun, ...result }, null, 2));
                return;
            }
            result.actions
                .filter((a) => o.verbose || a.layer !== 'column')
                .forEach((a) => console.log(`  ${OP_ICON[a.op]} ${LAYER_CN[a.layer].padEnd(4)}${a.id}${a.fields ? `  (${a.fields.join(', ')})` : ''}`));
            printCounts(result);
            if (result.conflicts.length) {
                console.log(`\n⚠ 跳过 ${result.conflicts.length} 张已挂在其他模块下的表（表名在组织内唯一，接口不能移动）：`);
                result.conflicts.forEach((c) => console.log(`  ${c}`));
            }
            console.log(o.dryRun ? '\n（--dry-run，未写入）' : `\n✓ 导入完成 — 组织 ${orgId}`);
        }
        catch (e) {
            if (e?.partial) {
                console.error('中断前已处理：');
                printCounts(e.partial);
            }
            console.error('✗ 导入表结构失败:', e instanceof Error ? e.message : String(e));
            process.exit(1);
        }
    });
}
exports.registerSchemaCommands = registerSchemaCommands;
//# sourceMappingURL=index.js.map
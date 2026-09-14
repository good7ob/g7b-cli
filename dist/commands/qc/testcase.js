"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerTestCaseCommands = void 0;
const path_1 = __importDefault(require("path"));
const ApiClient_1 = __importDefault(require("../../services/ApiClient"));
const testcaseFiles_1 = require("./testcaseFiles");
/**
 * 测试用例库 (prd-0082 FP-1~FP-3, api-0082) — backend TestCaseController, BASE PATH /qc/test.
 */
const STATUS_CN = { Draft: '草稿', Active: '生效', Deprecated: '废弃' };
const SOURCE_CN = { manual: '手工', rule_point: '由 RP 生成', feature_import: 'Gherkin 导入' };
const RESULT_ICON = { created: '＋', updated: '↻', skipped: '✗' };
const collect = (value, previous) => previous.concat([value]);
const csv = (value) => value ? value.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
function fail(label, e) {
    console.error(`✗ ${label}:`, e instanceof Error ? e.message : String(e));
    process.exit(1);
}
function registerTestCaseCommands(qcCommand) {
    const tc = qcCommand
        .command('testcase')
        .alias('tc')
        .description('测试用例库 — 列表、详情、创建、导入 Gherkin、RP 覆盖率、目录');
    // ── list ──────────────────────────────────────────────────────────────
    tc.command('list <product-id>')
        .description('列出产品下的测试用例')
        .option('--suite <id>', '目录 ID（含子目录）')
        .option('--status <status>', 'Draft|Active|Deprecated，逗号分隔')
        .option('--priority <priority>', 'P0|P1|P2|P3，逗号分隔')
        .option('--type <type>', 'Functional|UI|API|Integration|Regression|Smoke|E2E，逗号分隔')
        .option('--mode <mode>', 'Manual|Automated')
        .option('--keyword <keyword>', '标题或编号关键词')
        .option('-p, --page <num>', '页码', '1')
        .option('-l, --limit <num>', '每页条数', '20')
        .option('--json', '输出 JSON')
        .action(async (productId, o) => {
        try {
            const result = await ApiClient_1.default.post('/qc/test/cases/list', {
                productId: Number(productId),
                suiteId: o.suite ? Number(o.suite) : undefined,
                statuses: csv(o.status),
                priorities: csv(o.priority),
                caseTypes: csv(o.type),
                execMode: o.mode,
                keyword: o.keyword,
                pageNum: Number(o.page),
                pageSize: Number(o.limit),
            });
            if (o.json) {
                console.log(JSON.stringify(result, null, 2));
                return;
            }
            const cases = result?.list ?? [];
            if (!cases.length) {
                console.log('未找到测试用例。');
                return;
            }
            console.log(`\n测试用例 — 产品 ${productId}  (共 ${result.total} 条)`);
            console.log('─'.repeat(110));
            console.log('编号'.padEnd(10) + '标题'.padEnd(40) + '类型'.padEnd(13) + '优先级'.padEnd(7) + '执行'.padEnd(11) + '状态'.padEnd(8) + '更新时间');
            console.log('─'.repeat(110));
            cases.forEach((c) => {
                console.log(String(c.caseNo).padEnd(10) +
                    (c.title || '').substring(0, 38).padEnd(40) +
                    (c.caseType || '').padEnd(13) +
                    (c.priority || '').padEnd(7) +
                    (c.execMode || '').padEnd(11) +
                    (STATUS_CN[c.status] || c.status || '').padEnd(8) +
                    (c.updatedAt || '-'));
            });
            console.log('─'.repeat(110));
            if (result.total > cases.length)
                console.log(`（第 ${o.page} 页，共 ${result.total} 条）`);
            console.log();
        }
        catch (e) {
            fail('获取测试用例列表失败', e);
        }
    });
    // ── get ───────────────────────────────────────────────────────────────
    tc.command('get <id>')
        .description('查看用例详情（步骤 + 关联 RP）')
        .option('--json', '输出 JSON')
        .action(async (id, o) => {
        try {
            const c = await ApiClient_1.default.get(`/qc/test/cases/${id}`);
            if (o.json) {
                console.log(JSON.stringify(c, null, 2));
                return;
            }
            console.log('\n── 测试用例 ────────────────────────────────────────');
            console.log(`编号:       ${c.caseNo}   (ID ${c.id}，产品 ${c.productId}，目录 ${c.suiteId ?? '-'})`);
            console.log(`标题:       ${c.title}`);
            console.log(`状态:       ${STATUS_CN[c.status] ?? c.status} (${c.status})   类型: ${c.caseType}   优先级: ${c.priority}`);
            console.log(`执行方式:   ${c.execMode}   来源: ${SOURCE_CN[c.source] ?? c.source}`);
            if (c.scriptPath)
                console.log(`脚本位置:   ${c.scriptPath}  ›  ${c.scriptScenario}`);
            if (c.tags?.length)
                console.log(`标签:       ${c.tags.join(', ')}`);
            if (c.precondition)
                console.log(`前置条件:\n  ${c.precondition.replace(/\n/g, '\n  ')}`);
            console.log('\n── 步骤 ─────────────────────────────────────────────');
            (c.steps ?? []).forEach((s, i) => {
                console.log(`  ${i + 1}. ${s.action.replace(/\n/g, '\n     ')}`);
                if (s.expected)
                    console.log(`     → ${s.expected.replace(/\n/g, '\n       ')}`);
            });
            const rps = c.rulePoints ?? [];
            console.log(`\n── 关联 RP (${rps.length}) ───────────────────────────────────`);
            rps.forEach((rp) => console.log(`  ${rp.code}${rp.archived ? ' [已归档]' : ''}  ${rp.statement}`));
            console.log();
        }
        catch (e) {
            fail('获取用例详情失败', e);
        }
    });
    // ── create ────────────────────────────────────────────────────────────
    tc.command('create')
        .description('创建测试用例')
        .requiredOption('--product-id <id>', '产品 ID')
        .requiredOption('--title <title>', '用例标题')
        .option('--step <操作::预期>', '步骤，可重复；至少一条同时含操作与预期', collect, [])
        .option('--precondition <text>', '前置条件')
        .option('--suite <id>', '目录 ID')
        .option('--type <type>', 'Functional|UI|API|Integration|Regression|Smoke|E2E（默认 Functional）')
        .option('--priority <priority>', 'P0|P1|P2|P3（默认 P2）')
        .option('--mode <mode>', 'Manual|Automated（默认 Manual）')
        .option('--status <status>', 'Draft|Active（默认 Draft）')
        .option('--tag <tag>', '标签，可重复', collect, [])
        .option('--script-path <path>', '自动化脚本文件相对路径（Automated 必填）')
        .option('--script-scenario <name>', '脚本内场景名（Automated 必填）')
        .option('--rp <ids>', '关联 RP ID，逗号分隔')
        .option('--json', '输出 JSON')
        .action(async (o) => {
        try {
            const created = await ApiClient_1.default.post('/qc/test/cases', {
                productId: Number(o.productId),
                title: o.title,
                steps: o.step.map(testcaseFiles_1.parseStep),
                precondition: o.precondition,
                suiteId: o.suite ? Number(o.suite) : undefined,
                caseType: o.type,
                priority: o.priority,
                execMode: o.mode,
                status: o.status,
                tags: o.tag,
                scriptPath: o.scriptPath,
                scriptScenario: o.scriptScenario,
                rulePointIds: csv(o.rp)?.map(Number),
            });
            if (o.json) {
                console.log(JSON.stringify(created, null, 2));
                return;
            }
            console.log(`✓ 用例已创建  ${created.caseNo}  (ID ${created.id}，状态 ${created.status})`);
        }
        catch (e) {
            fail('创建用例失败', e);
        }
    });
    // ── import ────────────────────────────────────────────────────────────
    tc.command('import <paths...>')
        .description('导入 Gherkin .feature 文件（可传目录，递归查找）；同路径 + 场景名再次导入会更新而非重复创建')
        .requiredOption('--product-id <id>', '产品 ID')
        .option('--root <dir>', '脚本路径的相对基准目录，一般是仓库根目录', '.')
        .option('--base-path <prefix>', '统一的脚本路径前缀，覆盖按目录计算的结果')
        .option('--dry-run', '只列出将导入的文件与脚本路径，不上传')
        .option('--json', '输出 JSON')
        .action(async (paths, o) => {
        let done = 0;
        const total = { created: 0, updated: 0, skipped: 0, items: [] };
        try {
            const files = (0, testcaseFiles_1.collectFeatureFiles)(paths);
            if (!files.length)
                throw new Error('未找到 .feature 文件');
            const batches = (0, testcaseFiles_1.planBatches)(files, path_1.default.resolve(o.root), o.basePath);
            if (o.dryRun) {
                batches.forEach((b) => b.files.forEach((f) => console.log(`${b.basePath}${path_1.default.basename(f)}`)));
                console.log(`\n共 ${files.length} 个文件，将分 ${batches.length} 次请求上传（未上传，--dry-run）`);
                return;
            }
            for (const b of batches) {
                const fields = { productId: String(o.productId) };
                if (b.basePath)
                    fields.basePath = b.basePath;
                const r = await ApiClient_1.default.uploadFiles('/qc/test/cases/import-feature', b.files, 'files', fields);
                total.created += r?.created ?? 0;
                total.updated += r?.updated ?? 0;
                total.skipped += r?.skipped ?? 0;
                total.items.push(...(r?.items ?? []).map((i) => ({ ...i, file: `${b.basePath}${i.file}` })));
                done += 1;
            }
            if (o.json) {
                console.log(JSON.stringify(total, null, 2));
                return;
            }
            total.items.forEach((i) => {
                const where = i.scenario ? `${i.file} › ${i.scenario}` : i.file;
                console.log(`  ${RESULT_ICON[i.result] ?? ' '} ${(i.caseNo || '').padEnd(8)} ${where}${i.reason ? `  (${i.reason})` : ''}`);
            });
            console.log(`\n✓ 导入完成  新建 ${total.created}  更新 ${total.updated}  跳过 ${total.skipped}`);
        }
        catch (e) {
            if (done > 0)
                console.error(`已完成 ${done} 批：新建 ${total.created}  更新 ${total.updated}  跳过 ${total.skipped}`);
            fail('导入失败', e);
        }
    });
    // ── coverage ──────────────────────────────────────────────────────────
    tc.command('coverage <product-id>')
        .description('产品 RP 覆盖率（至少关联 1 条生效用例的 RP ÷ 未归档 RP）')
        .option('--all', '列出全部 RP（默认只列未覆盖）')
        .option('--json', '输出 JSON')
        .action(async (productId, o) => {
        try {
            const cov = await ApiClient_1.default.get(`/qc/test/products/${productId}/rp-coverage`);
            if (o.json) {
                console.log(JSON.stringify(cov, null, 2));
                return;
            }
            console.log(`\nRP 覆盖率 — 产品 ${productId}:  ${cov.coverageRate}%  (${cov.coveredRp}/${cov.totalRp})`);
            if (!cov.totalRp) {
                console.log('该产品没有未归档的 RP。');
                return;
            }
            const rows = (cov.rulePoints ?? []).filter((rp) => o.all || !rp.covered);
            if (!rows.length) {
                console.log('全部 RP 已覆盖。');
                return;
            }
            console.log(o.all ? '' : '未覆盖 RP:');
            rows.forEach((rp) => console.log(`  ${(rp.code || '').padEnd(14)} ${String(rp.activeCaseCount).padStart(3)} 条  ${rp.statement}`));
            console.log();
        }
        catch (e) {
            fail('获取 RP 覆盖率失败', e);
        }
    });
    // ── suites ────────────────────────────────────────────────────────────
    tc.command('suites <product-id>')
        .description('查看目录树（取目录 ID 用于 --suite）')
        .option('--json', '输出 JSON')
        .action(async (productId, o) => {
        try {
            const suites = (await ApiClient_1.default.get('/qc/test/suites', { productId })) ?? [];
            if (o.json) {
                console.log(JSON.stringify(suites, null, 2));
                return;
            }
            if (!suites.length) {
                console.log('该产品还没有目录。');
                return;
            }
            const print = (parentId, depth) => {
                suites.filter((s) => (s.parentId ?? null) === parentId)
                    .forEach((s) => { console.log(`${'  '.repeat(depth)}${s.name}  (ID ${s.id})`); print(s.id, depth + 1); });
            };
            print(null, 0);
        }
        catch (e) {
            fail('获取目录失败', e);
        }
    });
}
exports.registerTestCaseCommands = registerTestCaseCommands;
//# sourceMappingURL=testcase.js.map
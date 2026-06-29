"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerBugCommands = void 0;
const ApiClient_1 = __importDefault(require("../../services/ApiClient"));
const SEV_ICON = {
    blocker: '🔴', critical: '🟠', major: '🟡', minor: '🔵', trivial: '⚪',
};
const STATUS_CN = {
    open: '待处理', in_progress: '处理中', resolved: '已修复',
    reopen: '已重开', closed: '已关闭', rejected: '已拒绝',
};
function registerBugCommands(qcCommand) {
    const bugCmd = qcCommand
        .command('bug')
        .description('Bug 追踪 — 创建、列表、详情、状态流转、分配');
    // ── list ──────────────────────────────────────────────────────────────
    bugCmd
        .command('list <project-id>')
        .description('列出项目下的 Bug')
        .option('--status <status>', '按状态筛选（逗号分隔，可多选）')
        .option('--severity <severity>', '按严重度筛选（逗号分隔）')
        .option('--module <module>', '按模块名筛选')
        .option('--keyword <keyword>', '标题关键词搜索')
        .option('-p, --page <num>', '页码', '1')
        .option('-l, --limit <num>', '每页条数', '20')
        .option('--json', '输出 JSON')
        .action(async (projectId, options) => {
        try {
            const body = {
                projectId: parseInt(projectId),
                pageNum: parseInt(options.page),
                pageSize: parseInt(options.limit),
            };
            if (options.status)
                body.statuses = options.status.split(',');
            if (options.severity)
                body.severities = options.severity.split(',');
            if (options.module)
                body.moduleName = options.module;
            if (options.keyword)
                body.keyword = options.keyword;
            const result = await ApiClient_1.default.post('/qc/bugs/list', body);
            const bugs = result?.list || [];
            if (options.json) {
                console.log(JSON.stringify(result, null, 2));
                return;
            }
            if (!bugs.length) {
                console.log('未找到 Bug。');
                return;
            }
            console.log(`\nBug 列表 — 项目 ${projectId}  (共 ${result.total} 条)`);
            console.log('─'.repeat(108));
            console.log('ID'.padEnd(20) +
                '标题'.padEnd(30) +
                '严重度'.padEnd(12) +
                '状态'.padEnd(10) +
                '模块'.padEnd(18) +
                '创建时间');
            console.log('─'.repeat(108));
            bugs.forEach((b) => {
                const icon = SEV_ICON[b.severity] ?? ' ';
                console.log(String(b.id).padEnd(20) +
                    (b.title || '').substring(0, 28).padEnd(30) +
                    (icon + ' ' + (b.severity || '')).padEnd(12) +
                    (STATUS_CN[b.status] || b.status || '').padEnd(10) +
                    (b.moduleName || '-').substring(0, 16).padEnd(18) +
                    (b.createdAt || '-'));
            });
            console.log('─'.repeat(108));
            if (result?.total > bugs.length) {
                console.log(`（第 ${options.page} 页，共 ${result.total} 条）`);
            }
            console.log();
        }
        catch (e) {
            console.error('✗ 获取 Bug 列表失败:', e instanceof Error ? e.message : String(e));
            process.exit(1);
        }
    });
    // ── get ───────────────────────────────────────────────────────────────
    bugCmd
        .command('get <id>')
        .description('查看 Bug 详情（含操作历史）')
        .option('--json', '输出 JSON')
        .action(async (id, options) => {
        try {
            const result = await ApiClient_1.default.get(`/qc/bugs/${id}`);
            if (options.json) {
                console.log(JSON.stringify(result, null, 2));
                return;
            }
            const b = result?.bug ?? result;
            const history = result?.history ?? [];
            console.log('\n── Bug 详情 ────────────────────────────────────────');
            console.log(`ID:           ${b.id}`);
            console.log(`标题:         ${b.title}`);
            console.log(`状态:         ${STATUS_CN[b.status] ?? b.status}  (${b.status})`);
            console.log(`严重度:       ${SEV_ICON[b.severity] ?? ''} ${b.severity}   优先级: ${b.priority}`);
            console.log(`模块:         ${b.moduleName || '-'}`);
            console.log(`描述:         ${b.description || '-'}`);
            console.log(`负责人ID:     ${b.assignedTo || '-'}`);
            console.log(`开发人员ID:   ${b.developerId || '-'}`);
            console.log(`测试人员ID:   ${b.testerId || '-'}`);
            console.log(`修复次数:     ${b.fixCount ?? 0}   Reopen次数: ${b.reopenCount ?? 0}   验证次数: ${b.verifyCount ?? 0}`);
            console.log(`创建时间:     ${b.createdAt || '-'}`);
            if (b.firstResolvedAt)
                console.log(`首次解决:     ${b.firstResolvedAt}`);
            if (b.finalResolvedAt)
                console.log(`最终解决:     ${b.finalResolvedAt}`);
            if (b.closedAt)
                console.log(`关闭时间:     ${b.closedAt}`);
            if (b.reasonType)
                console.log(`原因分类:     ${b.reasonType}`);
            if (b.rootCause)
                console.log(`根本原因:     ${b.rootCause}`);
            if (history.length) {
                console.log('\n── 操作历史 ─────────────────────────────────────────');
                history.forEach((h) => {
                    const arrow = h.oldStatus ? `${h.oldStatus} → ${h.newStatus}` : h.newStatus;
                    console.log(`  [${h.createdAt}] ${(h.actionType || '').padEnd(10)} ${arrow}${h.comment ? '  ' + h.comment : ''}`);
                });
            }
            console.log();
        }
        catch (e) {
            console.error('✗ 获取 Bug 详情失败:', e instanceof Error ? e.message : String(e));
            process.exit(1);
        }
    });
    // ── create ────────────────────────────────────────────────────────────
    bugCmd
        .command('create')
        .description('创建新 Bug')
        .requiredOption('--project-id <id>', '项目 ID')
        .requiredOption('--title <title>', 'Bug 标题')
        .requiredOption('--module <module>', '模块名称')
        .option('--severity <severity>', '严重度 (blocker|critical|major|minor|trivial)', 'major')
        .option('--priority <priority>', '优先级 (high|medium|low)', 'medium')
        .option('--desc <desc>', 'Bug 描述')
        .option('--stage <stage>', '发现阶段 (dev_test|sit|uat|production)')
        .option('--source <source>', '来源 (tester|developer|customer|monitor|system|user)')
        .option('--json', '输出 JSON')
        .action(async (options) => {
        try {
            const body = {
                projectId: parseInt(options.projectId),
                title: options.title,
                moduleName: options.module,
                severity: options.severity,
                priority: options.priority,
            };
            if (options.desc)
                body.description = options.desc;
            if (options.stage)
                body.foundStage = options.stage;
            if (options.source)
                body.sourceType = options.source;
            const result = await ApiClient_1.default.post('/qc/bugs', body);
            if (options.json) {
                console.log(JSON.stringify(result, null, 2));
                return;
            }
            const bugId = result?.id ?? result?.data?.id;
            console.log(`✓ Bug 已创建  ID: ${bugId}  状态: open`);
        }
        catch (e) {
            console.error('✗ 创建 Bug 失败:', e instanceof Error ? e.message : String(e));
            process.exit(1);
        }
    });
    // ── transition ────────────────────────────────────────────────────────
    bugCmd
        .command('transition <id> <target-status>')
        .description('Bug 状态流转  (in_progress | resolved | closed | reopen | rejected)')
        .option('--comment <comment>', '操作说明（打回/拒绝时必填）')
        .option('--reason-type <type>', '原因分类（关闭时必填）')
        .option('--root-cause <cause>', '根本原因（关闭时必填）')
        .option('--assign-to <user-id>', '负责人用户 ID')
        .option('--developer-id <user-id>', '开发人员 ID')
        .option('--json', '输出 JSON')
        .action(async (id, targetStatus, options) => {
        try {
            const body = { targetStatus };
            if (options.comment)
                body.comment = options.comment;
            if (options.reasonType)
                body.reasonType = options.reasonType;
            if (options.rootCause)
                body.rootCause = options.rootCause;
            if (options.assignTo)
                body.assignedTo = parseInt(options.assignTo);
            if (options.developerId)
                body.developerId = parseInt(options.developerId);
            const result = await ApiClient_1.default.post(`/qc/bugs/${id}/transition`, body);
            if (options.json) {
                console.log(JSON.stringify(result, null, 2));
                return;
            }
            const newStatus = result?.status ?? targetStatus;
            console.log(`✓ Bug ${id} 状态已更新 → ${STATUS_CN[newStatus] ?? newStatus}  (${newStatus})`);
        }
        catch (e) {
            console.error('✗ 状态流转失败:', e instanceof Error ? e.message : String(e));
            process.exit(1);
        }
    });
    // ── assign ────────────────────────────────────────────────────────────
    bugCmd
        .command('assign <id>')
        .description('分配 Bug 给指定人员')
        .option('--assigned-to <user-id>', '负责人用户 ID')
        .option('--developer-id <user-id>', '开发人员 ID')
        .option('--tester-id <user-id>', '测试人员 ID')
        .action(async (id, options) => {
        try {
            const body = {};
            if (options.assignedTo)
                body.assignedTo = parseInt(options.assignedTo);
            if (options.developerId)
                body.developerId = parseInt(options.developerId);
            if (options.testerId)
                body.testerId = parseInt(options.testerId);
            await ApiClient_1.default.post(`/qc/bugs/${id}/assign`, body);
            console.log(`✓ Bug ${id} 已分配`);
        }
        catch (e) {
            console.error('✗ 分配失败:', e instanceof Error ? e.message : String(e));
            process.exit(1);
        }
    });
}
exports.registerBugCommands = registerBugCommands;
//# sourceMappingURL=bug.js.map
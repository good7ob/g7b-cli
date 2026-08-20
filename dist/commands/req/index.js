"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerReqCommands = void 0;
const ApiClient_1 = __importDefault(require("../../services/ApiClient"));
/**
 * Requirement backlog commands (MOD-04-SUB-10, prd-0068).
 *
 * The terminal is the point of this command group. `fun-forge-req-0001` asks for
 * capture in under 30 seconds and no more than three interactions; the web page
 * costs a browser, a login, an org picker and a product picker before you can
 * type. `g7b req add "想法"` is the version of that requirement that actually
 * holds up.
 */
const STATUS_LABEL = {
    inbox: '待判断',
    active: '在办',
    closed: '已终结',
};
const SOURCE_LABEL = {
    user_feedback: '用户反馈',
    sales: '销售',
    ops: '运营',
    strategy: '战略',
    data: '数据分析',
    competitor: '竞品',
    bug: '缺陷',
    tech_debt: '技术债',
};
const CLOSE_REASON_LABEL = {
    done: '已完成',
    rejected: '不做',
    duplicate: '重复',
    expired: '过期',
    out_of_scope: '超出范围',
};
const CHANGE_SOURCE_LABEL = {
    human: '人工',
    ai_clarify: 'AI 追问',
    rollback: '回滚',
};
/** Resolve the product id from the flag, then config, then fail with a usable hint. */
function resolveProductId(optionValue) {
    const raw = optionValue || process.env.GOOD7OB_PRODUCT_ID;
    const id = raw ? parseInt(raw, 10) : NaN;
    if (!id || Number.isNaN(id)) {
        throw new Error('缺少产品 ID。用 --product <id> 指定，或设置环境变量 GOOD7OB_PRODUCT_ID。\n' +
            '  查产品：good7ob org products <org-id>');
    }
    return id;
}
/** REQ-007 style display number. Falls back to the raw id when seq is missing. */
function reqNo(r) {
    return r?.seqNo ? `REQ-${String(r.seqNo).padStart(3, '0')}` : `#${r?.id ?? '-'}`;
}
/**
 * Resolve what the user typed into a database id.
 *
 * The list prints REQ-002 (a per-product sequence) while the API keys off a
 * global id — they diverge the moment a second product exists. Typing the
 * number you just read off the screen would then hit a different requirement,
 * possibly in a product you cannot even see. Accept both spellings and resolve
 * the REQ- form against the product before touching anything.
 */
async function resolveId(input, productOption) {
    const direct = /^[0-9]+$/.exec(input.trim());
    if (direct)
        return parseInt(input, 10);
    const seq = /^(?:REQ-?)?([0-9]+)$/i.exec(input.trim());
    if (!seq) {
        throw new Error(`无法识别的需求编号: ${input}（支持 42 或 REQ-002）`);
    }
    const productId = resolveProductId(productOption);
    const seqNo = parseInt(seq[1], 10);
    for (const status of ['inbox', 'active', 'closed']) {
        const page = await ApiClient_1.default.get('/forge/requirements', {
            productId, status, pageNum: 1, pageSize: 200,
        });
        const hit = (page?.records || page?.list || []).find((r) => r.seqNo === seqNo);
        if (hit)
            return hit.id;
    }
    throw new Error(`产品 ${productId} 下找不到 REQ-${String(seqNo).padStart(3, '0')}`);
}
function fail(message, error) {
    console.error(`✗ ${message}:`, error instanceof Error ? error.message : String(error));
    process.exit(1);
}
function registerReqCommands(program) {
    const reqCommand = program
        .command('req')
        .description('Requirement backlog — capture, triage, close, audit');
    // ── Capture ────────────────────────────────────────────────────
    reqCommand
        .command('add <title...>')
        .description('Record a requirement into the inbox (only the title is required)')
        .option('--product <id>', 'Product id (defaults to GOOD7OB_PRODUCT_ID)')
        .option('-d, --description <text>', 'Longer description')
        .option('-s, --source <source>', 'user_feedback|sales|ops|strategy|data|competitor|bug|tech_debt')
        .option('--source-detail <text>', 'Who asked, which customer, which ticket')
        .option('--parent <id>', 'Parent requirement id (Epic aggregation)')
        .option('--json', 'Output as JSON')
        .action(async (titleParts, options) => {
        try {
            const productId = resolveProductId(options.product);
            // Accepting title as variadic means `g7b req add 想要个导出功能` works
            // without quoting — one less thing between the thought and the record.
            const payload = { productId, title: titleParts.join(' ') };
            if (options.description)
                payload.description = options.description;
            if (options.source)
                payload.source = options.source;
            if (options.sourceDetail)
                payload.sourceDetail = options.sourceDetail;
            if (options.parent)
                payload.parentId = parseInt(options.parent, 10);
            const created = await ApiClient_1.default.post('/forge/requirements', payload);
            if (options.json) {
                console.log(JSON.stringify(created, null, 2));
                return;
            }
            console.log(`✓ 已记入待判断  ${reqNo(created)}  ${created.title}`);
        }
        catch (error) {
            fail('记录需求失败', error);
        }
    });
    // ── Views ──────────────────────────────────────────────────────
    reqCommand
        .command('ls')
        .description('List requirements by status (defaults to the inbox)')
        .option('--product <id>', 'Product id (defaults to GOOD7OB_PRODUCT_ID)')
        .option('--status <status>', 'inbox|active|closed', 'inbox')
        .option('-k, --keyword <text>', 'Search title and description')
        .option('--source <source>', 'Filter by source')
        .option('-p, --page <num>', 'Page number', '1')
        .option('-l, --limit <num>', 'Items per page', '20')
        .option('--json', 'Output as JSON')
        .option('--csv', 'Output as CSV')
        .action(async (options) => {
        try {
            const productId = resolveProductId(options.product);
            const params = {
                productId,
                status: options.status,
                pageNum: parseInt(options.page, 10) || 1,
                pageSize: parseInt(options.limit, 10) || 20,
            };
            if (options.keyword)
                params.keyword = options.keyword;
            if (options.source)
                params.source = options.source;
            const result = await ApiClient_1.default.get('/forge/requirements', params);
            const records = result?.records || result?.list || [];
            if (options.json) {
                console.log(JSON.stringify(result, null, 2));
                return;
            }
            if (options.csv) {
                console.log('ReqNo,Id,Title,Status,Source,CloseReason,CloseNote,CreatedAt');
                records.forEach((r) => {
                    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
                    console.log(`${reqNo(r)},${r.id},${esc(r.title)},${r.status || ''},${r.source || ''},` +
                        `${r.closeReason || ''},${esc(r.closeNote)},${r.createdAt || ''}`);
                });
                return;
            }
            if (!records.length) {
                console.log(`${STATUS_LABEL[options.status] || options.status}：没有需求。`);
                return;
            }
            const isClosed = options.status === 'closed';
            console.log(`\n${STATUS_LABEL[options.status] || options.status}`);
            console.log('─'.repeat(isClosed ? 96 : 78));
            records.forEach((r) => {
                const head = reqNo(r).padEnd(10) +
                    `#${r.id}`.padEnd(8) +
                    (r.title || '-').substring(0, 34).padEnd(36) +
                    (SOURCE_LABEL[r.source] || r.source || '-').padEnd(12);
                if (isClosed) {
                    // The whole reason this view exists is answering "why was this
                    // rejected last time", so the reason and note go on the row itself
                    // rather than behind a `req show`.
                    console.log(head + (CLOSE_REASON_LABEL[r.closeReason] || r.closeReason || '-'));
                    if (r.closeNote)
                        console.log(' '.repeat(10) + `└ ${r.closeNote}`);
                }
                else {
                    console.log(head + (r.createdAt || '-'));
                }
            });
            console.log('─'.repeat(isClosed ? 96 : 78));
            if (result?.total != null) {
                const pages = Math.max(1, Math.ceil(result.total / params.pageSize));
                console.log(`共 ${result.total} 条，第 ${params.pageNum}/${pages} 页`);
            }
        }
        catch (error) {
            fail('获取需求列表失败', error);
        }
    });
    reqCommand
        .command('show <id>')
        .description('Show one requirement in full')
        .option('--product <id>', 'Product id, used when the argument is a REQ- number')
        .option('--json', 'Output as JSON')
        .action(async (id, options) => {
        try {
            const rid = await resolveId(id, options.product);
            const r = await ApiClient_1.default.get(`/forge/requirements/${rid}`);
            if (options.json) {
                console.log(JSON.stringify(r, null, 2));
                return;
            }
            console.log(`\n${reqNo(r)}  ${r.title}`);
            console.log('─'.repeat(60));
            console.log(`状态:     ${STATUS_LABEL[r.status] || r.status || '-'}`);
            console.log(`来源:     ${SOURCE_LABEL[r.source] || r.source || '-'}${r.sourceDetail ? ` (${r.sourceDetail})` : ''}`);
            console.log(`优先级:   ${r.priority || '-'}`);
            console.log(`父需求:   ${r.parentId || '-'}`);
            console.log(`创建时间: ${r.createdAt || '-'}`);
            console.log(`更新时间: ${r.updatedAt || '-'}`);
            if (r.description) {
                console.log('\n描述:');
                console.log(r.description);
            }
            if (r.status === 'closed') {
                console.log(`\n关闭原因: ${CLOSE_REASON_LABEL[r.closeReason] || r.closeReason || '-'}`);
                console.log(`关闭说明: ${r.closeNote || '-'}`);
            }
        }
        catch (error) {
            fail('获取需求详情失败', error);
        }
    });
    // ── Lifecycle ──────────────────────────────────────────────────
    reqCommand
        .command('active <id>')
        .description('Move a requirement into the active set (subject to the hard cap)')
        .option('--product <id>', 'Product id, used when the argument is a REQ- number')
        .option('-r, --reason <text>', 'Why now')
        .option('--json', 'Output as JSON')
        .action(async (id, options) => {
        try {
            const rid = await resolveId(id, options.product);
            const moved = await ApiClient_1.default.post(`/forge/requirements/${rid}/status`, {
                toStatus: 'active',
                reason: options.reason,
            });
            if (options.json) {
                console.log(JSON.stringify(moved, null, 2));
                return;
            }
            console.log(`✓ 已移入在办  ${reqNo(moved)}  ${moved.title}`);
        }
        catch (error) {
            // The cap rejection carries the current active list precisely so the
            // caller can act on it. Printing "failed" and dropping that payload
            // would waste the one thing that makes the error useful.
            const payload = error?.payload;
            const list = payload?.data?.activeRequirements;
            if (Array.isArray(list) && list.length) {
                console.error(`✗ 在办已满 ${list.length}/${payload?.data?.activeLimit ?? list.length}，先关掉一条再放它进来：\n`);
                list.forEach((r) => {
                    console.error(`   ${reqNo(r).padEnd(10)}${(r.title || '-').substring(0, 40)}`);
                });
                console.error(`\n   关闭：good7ob req close <id> --reason <原因> --note <说明>`);
                process.exit(1);
            }
            fail('流转失败', error);
        }
    });
    reqCommand
        .command('inbox <id>')
        .description('Send a requirement back to the inbox (also revives a closed one)')
        .option('--product <id>', 'Product id, used when the argument is a REQ- number')
        .option('-r, --reason <text>', 'Why')
        .action(async (id, options) => {
        try {
            const rid = await resolveId(id, options.product);
            const moved = await ApiClient_1.default.post(`/forge/requirements/${rid}/status`, {
                toStatus: 'inbox',
                reason: options.reason,
            });
            console.log(`✓ 已退回待判断  ${reqNo(moved)}  ${moved.title}`);
        }
        catch (error) {
            fail('流转失败', error);
        }
    });
    reqCommand
        .command('close <id>')
        .description('Close a requirement (reason and note are both mandatory)')
        .option('--product <id>', 'Product id, used when the argument is a REQ- number')
        .requiredOption('-r, --reason <reason>', 'done|rejected|duplicate|out_of_scope')
        .requiredOption('-n, --note <text>', 'Why — this is what you will read next time someone proposes it again')
        .action(async (id, options) => {
        try {
            const rid = await resolveId(id, options.product);
            const closed = await ApiClient_1.default.post(`/forge/requirements/${rid}/close`, {
                closeReason: options.reason,
                closeNote: options.note,
            });
            console.log(`✓ 已关闭  ${reqNo(closed)}  ${closed.title}`);
            console.log(`  ${CLOSE_REASON_LABEL[options.reason] || options.reason}：${options.note}`);
        }
        catch (error) {
            fail('关闭需求失败', error);
        }
    });
    reqCommand
        .command('edit <id>')
        .description('Edit a requirement (title/description changes create a new version)')
        .option('--product <id>', 'Product id, used when the argument is a REQ- number')
        .option('-t, --title <text>', 'New title')
        .option('-d, --description <text>', 'New description')
        .option('-s, --source <source>', 'New source')
        .option('--priority <priority>', 'New priority')
        .action(async (id, options) => {
        try {
            const payload = {};
            if (options.title)
                payload.title = options.title;
            if (options.description)
                payload.description = options.description;
            if (options.source)
                payload.source = options.source;
            if (options.priority)
                payload.priority = options.priority;
            if (!Object.keys(payload).length) {
                console.error('✗ 没有要修改的字段。用 --title / --description / --source / --priority 指定。');
                process.exit(1);
            }
            const rid = await resolveId(id, options.product);
            const updated = await ApiClient_1.default.put(`/forge/requirements/${rid}`, payload);
            console.log(`✓ 已更新  ${reqNo(updated)}  ${updated.title}`);
        }
        catch (error) {
            fail('更新需求失败', error);
        }
    });
    reqCommand
        .command('rm <id>')
        .description('Soft-delete a requirement')
        .option('--product <id>', 'Product id, used when the argument is a REQ- number')
        .action(async (id, options) => {
        try {
            const rid = await resolveId(id, options?.product);
            await ApiClient_1.default.delete(`/forge/requirements/${rid}`);
            console.log(`✓ 已删除需求 ${id}`);
        }
        catch (error) {
            fail('删除需求失败', error);
        }
    });
    // ── Audit ──────────────────────────────────────────────────────
    reqCommand
        .command('history <id>')
        .description('Show content versions and state transitions')
        .option('--product <id>', 'Product id, used when the argument is a REQ- number')
        .option('--json', 'Output as JSON')
        .action(async (id, options) => {
        try {
            const rid = await resolveId(id, options.product);
            const [versions, logs] = await Promise.all([
                ApiClient_1.default.get(`/forge/requirements/${rid}/versions`).catch(() => null),
                ApiClient_1.default.get(`/forge/requirements/${rid}/state-logs`).catch(() => null),
            ]);
            if (options.json) {
                console.log(JSON.stringify({ versions, logs }, null, 2));
                return;
            }
            // These two endpoints ship with the version UI (tier 2). Say so plainly
            // instead of printing an empty section that reads like "no history".
            if (!versions && !logs) {
                console.log('版本与状态日志接口尚未开放（归档2 的 fun-forge-req-0017 查看能力）。');
                console.log('数据已在记录，可先用 good7ob req show <id> 看当前值。');
                return;
            }
            if (Array.isArray(versions) && versions.length) {
                console.log('\n内容版本');
                console.log('─'.repeat(70));
                versions.forEach((v) => {
                    console.log(`v${String(v.versionNo).padEnd(4)}` +
                        (CHANGE_SOURCE_LABEL[v.changeSource] || v.changeSource || '-').padEnd(10) +
                        (v.createdAt || '-').padEnd(22) +
                        (v.title || '-').substring(0, 30));
                });
            }
            if (Array.isArray(logs) && logs.length) {
                console.log('\n状态流转');
                console.log('─'.repeat(70));
                logs.forEach((l) => {
                    console.log(`${(STATUS_LABEL[l.fromStatus] || l.fromStatus || '新建').padEnd(8)}→ ` +
                        `${(STATUS_LABEL[l.toStatus] || l.toStatus || '-').padEnd(8)}` +
                        `${(l.operatorType || '-').padEnd(8)}` +
                        `${(l.createdAt || '-').padEnd(22)}${l.reason || ''}`);
                });
            }
        }
        catch (error) {
            fail('获取需求历史失败', error);
        }
    });
}
exports.registerReqCommands = registerReqCommands;
//# sourceMappingURL=index.js.map
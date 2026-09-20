"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderRebuild = exports.renderBurnup = exports.renderScopeChange = exports.renderScopeChanges = exports.renderConfig = void 0;
const cliHelpers_1 = require("../../../utils/cliHelpers");
const kpi_1 = require("./kpi");
const burnupChart_1 = require("./burnupChart");
const signed = (n) => (n == null ? cliHelpers_1.DASH : `${n > 0 ? '+' : ''}${(0, cliHelpers_1.fmtNum)(n)}`);
function renderConfig(c, saved = false) {
    const overrides = c.statusCompletion ?? {};
    const effective = c.effectiveStatusCompletion ?? {};
    const defaults = c.defaultStatusCompletion ?? {};
    const statuses = Array.from(new Set([...Object.keys(defaults), ...Object.keys(effective), ...Object.keys(overrides)]));
    const rows = [['状态', '默认', '生效', '覆盖']].concat(statuses.map((s) => [s, (0, cliHelpers_1.fmtNum)(defaults[s], '%'), (0, cliHelpers_1.fmtNum)(effective[s], '%'), (0, cliHelpers_1.fmtNum)(overrides[s], '%')]));
    return [
        `${saved ? '✓ 已保存  ' : ''}产品进度配置  产品 #${(0, cliHelpers_1.dash)(c.productId)}${c.configured ? '' : '    （未配置，使用默认值）'}`,
        '─'.repeat(60),
        (0, kpi_1.block)([
            ['工作量口径', (0, kpi_1.basisLabel)(c.weightBasis)],
            ['更新', c.updatedAt ? `${(0, cliHelpers_1.fmtDateTime)(c.updatedAt)} by ${(0, cliHelpers_1.dash)(c.updatedBy)}` : cliHelpers_1.DASH],
        ]),
        '',
        '任务状态完成度',
        (0, cliHelpers_1.renderTable)(rows),
        '未列出的状态（paused / blocked）取任务自身进度；completed 恒为 100，cancelled 不计入范围。完成度 = max(状态值, 任务进度)。',
    ].join('\n');
}
exports.renderConfig = renderConfig;
const taskCounts = (c) => c.addedTaskIds?.length || c.removedTaskIds?.length ? `+${c.addedTaskIds?.length ?? 0}/-${c.removedTaskIds?.length ?? 0}` : cliHelpers_1.DASH;
function renderScopeChanges(page) {
    const records = page.records ?? [];
    if (!records.length)
        return '没有范围变更记录。';
    const rows = [['ID', '时间', '类型', '变化', '变更后', '口径', 'Release', '任务', '原因']].concat(records.map((c) => [
        String(c.id), (0, cliHelpers_1.fmtDateTime)(c.changedAt), (0, cliHelpers_1.dash)(c.kind), signed(c.deltaScope), (0, cliHelpers_1.fmtNum)(c.scopeAfter), (0, cliHelpers_1.dash)(c.weightBasis),
        (0, cliHelpers_1.dash)(c.releaseId), taskCounts(c), (0, cliHelpers_1.dash)(c.reason),
    ]));
    return `${(0, cliHelpers_1.renderTable)(rows, { 8: { truncate: 40 } })}\n共 ${(0, cliHelpers_1.dash)(page.total)} 条，第 ${(0, cliHelpers_1.dash)(page.current)}/${(0, cliHelpers_1.dash)(page.pages)} 页`;
}
exports.renderScopeChanges = renderScopeChanges;
function renderScopeChange(c, verb) {
    return [
        `✓ 范围变更已${verb}  #${c.id}`,
        (0, kpi_1.block)([
            ['类型', (0, cliHelpers_1.dash)(c.kind)],
            ['变化', `${signed(c.deltaScope)} ${(0, kpi_1.basisLabel)(c.weightBasis)}`],
            ['变更后范围', (0, cliHelpers_1.fmtNum)(c.scopeAfter)],
            ['Release', (0, cliHelpers_1.dash)(c.releaseId)],
            ['原因', (0, cliHelpers_1.dash)(c.reason)],
            ['时间', (0, cliHelpers_1.fmtDateTime)(c.changedAt)],
        ]),
    ].join('\n');
}
exports.renderScopeChange = renderScopeChange;
function renderBurnup(b) {
    const points = b.points ?? [];
    const head = [
        `Burnup  产品 #${(0, cliHelpers_1.dash)(b.productId)}${b.releaseId ? `  Release #${b.releaseId}` : ''}    ${(0, cliHelpers_1.fmtDate)(b.from)} → ${(0, cliHelpers_1.fmtDate)(b.to)}`,
        `口径 ${(0, kpi_1.basisLabel)(b.weightBasis)}    基线范围 ${(0, cliHelpers_1.fmtNum)(b.baselineScope)}`,
    ];
    if (!points.length) {
        return [...head, '该区间没有快照数据（每日快照 23:50 UTC 生成；可用 `pm health snapshots rebuild` 补齐历史）。'].join('\n');
    }
    const ceiling = Math.max(0, ...points.flatMap((p) => [p.scope ?? 0, p.completed ?? 0]));
    const sampled = (0, burnupChart_1.downsample)(points);
    const rows = [['日期', '范围', '已完成', '剩余', '完成度']].concat(points.map((p) => [(0, cliHelpers_1.dash)(p.date), (0, cliHelpers_1.fmtNum)(p.scope), (0, cliHelpers_1.fmtNum)(p.completed), (0, cliHelpers_1.fmtNum)(p.remaining), (0, burnupChart_1.progressBar)(p.completed, p.scope)]));
    return [
        ...head,
        '',
        `范围   ${(0, burnupChart_1.sparkline)(sampled.map((p) => p.scope), ceiling)}  (max ${(0, cliHelpers_1.fmtNum)(ceiling)})`,
        `完成   ${(0, burnupChart_1.sparkline)(sampled.map((p) => p.completed), ceiling)}`,
        '',
        (0, cliHelpers_1.renderTable)(rows),
        `共 ${points.length} 个数据点${points.length > sampled.length ? `（上方走势图已抽样为 ${sampled.length} 点）` : ''}`,
    ].join('\n');
}
exports.renderBurnup = renderBurnup;
function renderRebuild(r) {
    return [
        `✓ 快照重建完成  ${(0, cliHelpers_1.dash)(r.from)} → ${(0, cliHelpers_1.dash)(r.to)}（${(0, cliHelpers_1.dash)(r.days)} 天）`,
        (0, kpi_1.block)([
            ['新建', (0, cliHelpers_1.dash)(r.created)],
            ['已存在（跳过，不覆盖）', (0, cliHelpers_1.dash)(r.skipped)],
        ]),
        '注意：已删除的任务无法还原；工作量 / 执行者 / Release 归属取当前值。',
    ].join('\n');
}
exports.renderRebuild = renderRebuild;
//# sourceMappingURL=renderProgress.js.map
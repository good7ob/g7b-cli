"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderActivityList = void 0;
const cliHelpers_1 = require("../../../utils/cliHelpers");
const actorCell = (a) => a.actorName ? String(a.actorName) : a.actorType ? `${a.actorType}${a.actorId ? `:${a.actorId}` : ''}` : (0, cliHelpers_1.dash)(a.actorName);
const taskCell = (a) => (a.taskId ? `#${a.taskId}${a.taskName ? ` ${a.taskName}` : ''}` : (0, cliHelpers_1.dash)(a.taskName));
/** Table + the cursor footer; renderTable strips control characters from every cell (rp-pm-activity-0042). */
function renderActivityList(page) {
    const items = page.items ?? [];
    const footer = `nextSinceId=${(0, cliHelpers_1.dash)(page.nextSinceId)} hasMore=${(0, cliHelpers_1.dash)(page.hasMore)}`;
    if (!items.length)
        return `没有符合条件的动态。\n${footer}`;
    const rows = [['ID', '时间', '来源', '渠道', '类型', '任务', '摘要']].concat(items.map((a) => [
        (0, cliHelpers_1.dash)(a.id), (0, cliHelpers_1.fmtDateTime)(a.createdAt), actorCell(a), (0, cliHelpers_1.dash)(a.channel), (0, cliHelpers_1.dash)(a.type), taskCell(a), (0, cliHelpers_1.dash)(a.summary),
    ]));
    return `${(0, cliHelpers_1.renderTable)(rows, { 2: { truncate: 24 }, 5: { truncate: 30 }, 6: { truncate: 80 } })}\n${footer}`;
}
exports.renderActivityList = renderActivityList;
//# sourceMappingURL=render.js.map
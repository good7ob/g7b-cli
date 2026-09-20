"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.describeLink = exports.renderTraceList = void 0;
const cliHelpers_1 = require("../../utils/cliHelpers");
const extractRecords_1 = require("../../utils/extractRecords");
const end = (type, id) => `${(0, cliHelpers_1.dash)(type)}#${(0, cliHelpers_1.dash)(id)}`;
function renderTraceList(result, pageNum, pageSize) {
    const records = (0, extractRecords_1.extractRecords)(result);
    if (!records.length)
        return '没有符合条件的追溯关系。';
    const rows = [['ID', '来源', '关系', '目标', '创建人', '创建时间']].concat(records.map((l) => [
        String(l.id), end(l.sourceType, l.sourceId), (0, cliHelpers_1.dash)(l.linkType), end(l.targetType, l.targetId),
        (0, cliHelpers_1.dash)(l.createdBy), (0, cliHelpers_1.fmtDateTime)(l.createdAt),
    ]));
    const total = (0, extractRecords_1.extractTotal)(result, records);
    const pages = Math.max(1, Math.ceil(total / pageSize));
    return `${(0, cliHelpers_1.renderTable)(rows)}\n共 ${total} 条，第 ${pageNum}/${pages} 页`;
}
exports.renderTraceList = renderTraceList;
/** `IDEA#5 —derived_from→ REQUIREMENT#9` */
function describeLink(l) {
    return `${end(l.sourceType, l.sourceId)} —${(0, cliHelpers_1.dash)(l.linkType)}→ ${end(l.targetType, l.targetId)}`;
}
exports.describeLink = describeLink;
//# sourceMappingURL=render.js.map
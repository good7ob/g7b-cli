"use strict";
/** Rendered template output (instance / upgrade preview / dry-run): a document body, or structured JSON. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resultLines = exports.outText = exports.documentBody = void 0;
const renderVersion_1 = require("./renderVersion");
/** Document templates render to `{format, body}`; anything else has no top-level text body. */
function documentBody(rendered) {
    const doc = rendered;
    return doc && typeof doc === 'object' && typeof doc.body === 'string'
        ? { format: typeof doc.format === 'string' ? doc.format : 'text', body: doc.body }
        : undefined;
}
exports.documentBody = documentBody;
/** What `--out` writes: the document body itself, or the rendered JSON of a structured template. */
function outText(rendered) {
    return documentBody(rendered)?.body ?? JSON.stringify(rendered ?? null, null, 2);
}
exports.outText = outText;
/**
 * The rendered result for a terminal: a document body in full, structured content as its first lines, or (with
 * `writtenTo`) just a pointer to the file it went to. The body is untrusted text, sanitised by `emit`.
 */
function resultLines(rendered, writtenTo) {
    if (writtenTo)
        return [`✓ 渲染结果已写入 ${writtenTo}`];
    const doc = documentBody(rendered);
    return doc ? [`渲染结果 (${doc.format}):`, doc.body] : (0, renderVersion_1.renderContent)(rendered, '渲染结果');
}
exports.resultLines = resultLines;
//# sourceMappingURL=renderBody.js.map
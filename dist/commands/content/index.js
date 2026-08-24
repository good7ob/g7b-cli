"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.csvField = exports.registerContentCommands = void 0;
const ApiClient_1 = __importDefault(require("../../services/ApiClient"));
const extractRecords_1 = require("../../utils/extractRecords");
/**
 * Read-only CLI access to org product copy/text resources
 * (MOD-19-SUB-09, fun-org-copy-0005).
 *
 * Calls the same plain list endpoint used by the web "文案资源" tab —
 * not the CSV/SQL export endpoint — and only differs in how the
 * response is rendered locally (table/json/csv).
 */
function registerContentCommands(program) {
    const contentCommand = program
        .command('content')
        .description('Read-only access to org product copy/text resources');
    contentCommand
        .command('list')
        .description('List copy/text resources for a product')
        .requiredOption('--product-id <id>', 'Product ID (org_products.id)')
        .option('--category <category>', 'Filter by category, e.g. login')
        .option('--key <keyword>', 'Filter by key keyword')
        .option('--locale <locale>', 'Filter by locale, e.g. zh/en/ja')
        .option('-p, --page <num>', 'Page number', '1')
        .option('-l, --limit <num>', 'Items per page', '100')
        .option('--format <format>', 'Output format: table|json|csv', 'table')
        .action(async (options) => {
        try {
            const params = {
                page: parseInt(options.page, 10) || 1,
                pageSize: parseInt(options.limit, 10) || 100,
            };
            if (options.category)
                params.category = options.category;
            if (options.key)
                params.key = options.key;
            if (options.locale)
                params.locale = options.locale;
            const result = await ApiClient_1.default.get(`/api/v1/orgs/products/${options.productId}/copy-resources`, params);
            const records = (0, extractRecords_1.extractRecords)(result);
            const format = String(options.format || 'table').toLowerCase();
            if (format === 'json') {
                console.log(JSON.stringify(records, null, 2));
                return;
            }
            if (format === 'csv') {
                console.log('id,category,key,locale,value,updatedBy,updatedAt');
                records.forEach((r) => {
                    console.log([
                        r.id,
                        csvField(r.category),
                        csvField(r.key),
                        csvField(r.locale),
                        csvField(r.value),
                        r.updatedBy ?? '',
                        r.updatedAt ?? '',
                    ].join(','));
                });
                return;
            }
            if (!records.length) {
                console.log('No copy resources found.');
                return;
            }
            console.log(`\n文案资源 — 产品 ${options.productId}`);
            console.log('─'.repeat(90));
            console.log('ID'.padEnd(8) +
                '分类'.padEnd(14) +
                'Key'.padEnd(28) +
                '语言'.padEnd(8) +
                '文案内容');
            console.log('─'.repeat(90));
            records.forEach((r) => {
                console.log(String(r.id).padEnd(8) +
                    (r.category || '-').padEnd(14) +
                    (r.key || '-').substring(0, 26).padEnd(28) +
                    (r.locale || '-').padEnd(8) +
                    (r.value || '').substring(0, 40));
            });
            console.log('─'.repeat(90));
        }
        catch (error) {
            // The backend wraps auth failures in a 200 response with a
            // non-200 `code` (see Result.failed), not an HTTP 403 — surface
            // the message either way rather than special-casing a status
            // code that never actually appears here (fun-org-copy-0005).
            const message = error instanceof Error ? error.message : String(error);
            if (/access denied/i.test(message)) {
                console.error('✗ 无权限访问该产品的文案资源:', message);
            }
            else {
                console.error('✗ 获取文案资源失败:', message);
            }
            process.exit(1);
        }
    });
    return contentCommand;
}
exports.registerContentCommands = registerContentCommands;
function csvField(value) {
    const str = value === null || value === undefined ? '' : String(value);
    const needsQuoting = /[",\n\r]/.test(str);
    const escaped = str.replace(/"/g, '""');
    return needsQuoting ? `"${escaped}"` : escaped;
}
exports.csvField = csvField;
//# sourceMappingURL=index.js.map
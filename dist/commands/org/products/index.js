"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerProductCommands = void 0;
const ApiClient_1 = __importDefault(require("../../../services/ApiClient"));
function registerProductCommands(orgCommand) {
    // list products
    orgCommand
        .command('products <org-id>')
        .description('List products in an organization')
        .option('--status <status>', 'Filter by status (active|archived)')
        .option('-p, --page <num>', 'Page number', '1')
        .option('-l, --limit <num>', 'Items per page', '20')
        .option('--json', 'Output as JSON')
        .option('--csv', 'Output as CSV')
        .action(async (orgId, options) => {
        try {
            const params = {
                page: parseInt(options.page) || 1,
                pageSize: parseInt(options.limit) || 20,
            };
            if (options.status)
                params.status = options.status;
            const result = await ApiClient_1.default.get(`/api/v1/orgs/${orgId}/products`, params);
            const records = Array.isArray(result) ? result : result?.records || [];
            if (options.json) {
                console.log(JSON.stringify(result, null, 2));
                return;
            }
            if (options.csv) {
                console.log('ID,Name,Status,Description,CreatedAt');
                records.forEach((p) => {
                    console.log(`${p.id},"${p.name}",${p.status || ''},"${p.description || ''}",${p.createdAt || ''}`);
                });
                return;
            }
            if (!records.length) {
                console.log('No products found.');
                return;
            }
            console.log(`\n产品列表 — 组织 ${orgId}`);
            console.log('─'.repeat(80));
            console.log('ID'.padEnd(8) + '产品名称'.padEnd(28) + '状态'.padEnd(12) + '技术标签'.padEnd(20) + '创建时间');
            console.log('─'.repeat(80));
            records.forEach((p) => {
                const tags = Array.isArray(p.techTags) ? p.techTags.join(',') : (p.techTags || '-');
                console.log(String(p.id).padEnd(8) +
                    (p.name || '').substring(0, 26).padEnd(28) +
                    (p.status || '-').padEnd(12) +
                    tags.substring(0, 18).padEnd(20) +
                    (p.createdAt || '-'));
            });
            console.log('─'.repeat(80));
        }
        catch (error) {
            console.error('✗ 获取产品列表失败:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
    // get product
    orgCommand
        .command('product-get <org-id> <product-id>')
        .description('Get product details')
        .option('--json', 'Output as JSON')
        .action(async (orgId, productId, options) => {
        try {
            const product = await ApiClient_1.default.get(`/api/v1/orgs/${orgId}/products/${productId}`);
            if (options.json) {
                console.log(JSON.stringify(product, null, 2));
                return;
            }
            console.log('\n产品详情');
            console.log('─'.repeat(50));
            console.log(`ID:     ${product.id}`);
            console.log(`名称:   ${product.name}`);
            console.log(`状态:   ${product.status || '-'}`);
            console.log(`描述:   ${product.description || '-'}`);
            const tags = Array.isArray(product.techTags) ? product.techTags.join(', ') : (product.techTags || '-');
            console.log(`技术栈: ${tags}`);
            console.log(`创建:   ${product.createdAt || '-'}`);
            console.log('─'.repeat(50));
        }
        catch (error) {
            console.error('✗ 获取产品详情失败:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
    // create product
    orgCommand
        .command('create-product <org-id>')
        .description('Create a product in an organization')
        .requiredOption('--name <name>', 'Product name')
        .option('--description <desc>', 'Product description')
        .option('--tech-tags <tags>', 'Technology tags (comma-separated)')
        .option('--cover-url <url>', 'Cover image URL')
        .option('--json', 'Output result as JSON')
        .action(async (orgId, options) => {
        try {
            const body = { name: options.name };
            if (options.description)
                body.description = options.description;
            if (options.techTags)
                body.techTags = options.techTags.split(',').map((t) => t.trim());
            if (options.coverUrl)
                body.coverUrl = options.coverUrl;
            const product = await ApiClient_1.default.post(`/api/v1/orgs/${orgId}/products`, body);
            if (options.json) {
                console.log(JSON.stringify(product, null, 2));
                return;
            }
            console.log(`✓ 产品已创建: [${product?.id || ''}] ${options.name}`);
        }
        catch (error) {
            console.error('✗ 创建产品失败:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
    // update product
    orgCommand
        .command('update-product <org-id> <product-id>')
        .description('Update a product')
        .option('--name <name>', 'Product name')
        .option('--description <desc>', 'Product description')
        .option('--tech-tags <tags>', 'Technology tags (comma-separated)')
        .option('--cover-url <url>', 'Cover image URL')
        .option('--status <status>', 'Status (active|archived)')
        .action(async (orgId, productId, options) => {
        try {
            const body = {};
            if (options.name)
                body.name = options.name;
            if (options.description)
                body.description = options.description;
            if (options.techTags)
                body.techTags = options.techTags.split(',').map((t) => t.trim());
            if (options.coverUrl)
                body.coverUrl = options.coverUrl;
            if (options.status)
                body.status = options.status;
            await ApiClient_1.default.put(`/api/v1/orgs/${orgId}/products/${productId}`, body);
            console.log(`✓ 产品已更新: ${productId}`);
        }
        catch (error) {
            console.error('✗ 更新产品失败:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
    // delete/archive product
    orgCommand
        .command('delete-product <org-id> <product-id>')
        .description('Archive or permanently delete a product')
        .option('--hard-delete', 'Permanently delete instead of archive')
        .option('-f, --force', 'Skip confirmation')
        .action(async (orgId, productId, options) => {
        try {
            if (!options.force) {
                const action = options.hardDelete ? '永久删除' : '归档';
                console.log(`⚠ 即将${action}产品 ${productId}，使用 -f/--force 确认`);
                process.exit(0);
            }
            const action = options.hardDelete ? 'delete' : 'archive';
            await ApiClient_1.default.delete(`/api/v1/orgs/${orgId}/products/${productId}?action=${action}`);
            console.log(`✓ 产品已${options.hardDelete ? '永久删除' : '归档'}: ${productId}`);
        }
        catch (error) {
            console.error('✗ 删除产品失败:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
}
exports.registerProductCommands = registerProductCommands;
//# sourceMappingURL=index.js.map
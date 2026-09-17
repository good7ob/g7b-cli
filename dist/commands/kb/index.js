"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerKbCommands = void 0;
const ApiClient_1 = __importDefault(require("../../services/ApiClient"));
const sse_1 = require("./sse");
const SOURCE_TYPES = ['upload', 'prd', 'notion', 'github', 'confluence'];
/**
 * Knowledge base (Dify-backed) access: list documents, semantic search, and
 * streaming Q&A. Same /forge/kb endpoints the web KB page and MCP tools use.
 */
function registerKbCommands(program) {
    const kb = program
        .command('kb')
        .description('Knowledge base (Dify) — list documents, search, chat');
    kb
        .command('ls')
        .description('List knowledge base documents')
        .option('--source <type>', `Filter by source type: ${SOURCE_TYPES.join('|')}`)
        .option('--name <keyword>', 'Filter by document name (case-insensitive substring)')
        .option('--status <status>', 'Filter by status, e.g. ready|failed')
        .option('--format <format>', 'Output format: table|json', 'table')
        .action(async (options) => {
        try {
            if (options.source && !SOURCE_TYPES.includes(options.source)) {
                throw new Error(`--source must be one of: ${SOURCE_TYPES.join(', ')}`);
            }
            const params = options.source ? { sourceType: options.source } : undefined;
            const docs = (await ApiClient_1.default.get('/forge/kb/documents', params)) ?? [];
            const keyword = options.name?.toLowerCase();
            const records = docs.filter((d) => (!keyword || String(d.name ?? '').toLowerCase().includes(keyword)) &&
                (!options.status || d.status === options.status));
            if (options.format === 'json') {
                console.log(JSON.stringify(records, null, 2));
                return;
            }
            if (!records.length) {
                console.log('No documents found.');
                return;
            }
            console.log('─'.repeat(100));
            console.log('ID'.padEnd(7) + 'Status'.padEnd(9) + 'Source'.padEnd(9) + 'Created'.padEnd(12) + 'Name');
            console.log('─'.repeat(100));
            records.forEach((d) => {
                console.log(String(d.id).padEnd(7) +
                    String(d.status ?? '-').padEnd(9) +
                    String(d.sourceType ?? '-').padEnd(9) +
                    formatDate(d.createdAt).padEnd(12) +
                    d.name);
            });
            console.log('─'.repeat(100));
            console.log(`Total: ${records.length}`);
        }
        catch (error) {
            console.error('✗ 获取知识库文档失败:', error.message);
            process.exit(1);
        }
    });
    kb
        .command('search <query...>')
        .description('Semantic search over the knowledge base; prints matching chunks')
        .option('-l, --limit <num>', 'Max results (server caps at 20)', '10')
        .option('--format <format>', 'Output format: text|json', 'text')
        .action(async (queryParts, options) => {
        try {
            const q = queryParts.join(' ');
            const result = await ApiClient_1.default.get('/forge/kb/search', {
                q,
                limit: parseInt(options.limit, 10) || 10,
            });
            const hits = result?.results ?? [];
            if (options.format === 'json') {
                console.log(JSON.stringify(hits, null, 2));
                return;
            }
            if (!hits.length) {
                console.log('No results.');
                return;
            }
            hits.forEach((h, i) => {
                const score = typeof h.score === 'number' ? h.score.toFixed(3) : '-';
                console.log(`\n[${i + 1}] score=${score}${h.documentName ? `  ${h.documentName}` : ''}`);
                console.log('─'.repeat(80));
                console.log(h.content || '(name match only, no content)');
            });
        }
        catch (error) {
            console.error('✗ 知识库搜索失败:', error.message);
            process.exit(1);
        }
    });
    kb
        .command('chat <message...>')
        .description('Ask the knowledge base; streams the AI answer with citations')
        .option('--no-citations', 'Do not print citations after the answer')
        .option('--json', 'Print only the final result as JSON (answer, citations, usage)')
        .action(async (messageParts, options) => {
        try {
            const stream = await ApiClient_1.default.postStream('/forge/kb/chat', { message: messageParts.join(' ') });
            const final = await consumeChat(stream, options.json ? () => { } : (t) => process.stdout.write(t));
            if (options.json) {
                console.log(JSON.stringify(final, null, 2));
                return;
            }
            process.stdout.write('\n');
            if (options.citations && final.citations.length) {
                console.log('\n引用:');
                final.citations.forEach((c, i) => {
                    const score = typeof c.score === 'number' ? ` (${c.score.toFixed(3)})` : '';
                    console.log(`  [${i + 1}] ${c.documentName ?? c.documentId ?? '-'}${score}`);
                });
            }
        }
        catch (error) {
            console.error('\n✗ 知识库对话失败:', error.message);
            process.exit(1);
        }
    });
    return kb;
}
exports.registerKbCommands = registerKbCommands;
function consumeChat(stream, onText) {
    return new Promise((resolve, reject) => {
        const result = { answer: '', citations: [] };
        let buffer = '';
        let settled = false;
        const finish = (err) => {
            if (settled)
                return;
            settled = true;
            err ? reject(err) : resolve(result);
        };
        stream.setEncoding('utf8');
        stream.on('data', (chunk) => {
            const parsed = (0, sse_1.parseSseBuffer)(buffer + chunk);
            buffer = parsed.rest;
            for (const ev of parsed.events) {
                let payload;
                try {
                    payload = JSON.parse(ev.data);
                }
                catch {
                    continue;
                }
                if (ev.event === 'error')
                    return finish(new Error(payload.error || ev.data));
                if (payload.content) {
                    result.answer += payload.content;
                    onText(payload.content);
                }
                if (payload.done) {
                    result.citations = payload.citations ?? [];
                    result.usage = payload.usage;
                    result.lowConfidence = payload.lowConfidence;
                    result.knowledgeBaseEmpty = payload.knowledgeBaseEmpty;
                }
            }
        });
        stream.on('end', () => finish());
        stream.on('error', (err) => finish(err));
    });
}
// Jackson serializes LocalDateTime as [y, m, d, h, mi, s, ns] here.
function formatDate(value) {
    if (Array.isArray(value) && value.length >= 3) {
        return `${value[0]}-${String(value[1]).padStart(2, '0')}-${String(value[2]).padStart(2, '0')}`;
    }
    return typeof value === 'string' ? value.slice(0, 10) : '-';
}
//# sourceMappingURL=index.js.map
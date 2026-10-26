import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import apiClient from '../../services/ApiClient';
import configService from '../../services/ConfigService';
import { resolveOrgId } from '../../utils/resolveOrgId';
import { dash, emit, fmtDateTime, guarded, InputError, parseId, renderTable } from '../../utils/cliHelpers';

const ORG_OPTION = '--org-id <id>';
const ORG_DESC = '组织 ID（知识库按组织隔离，作为 X-Tenant-Id 发送；也可用 GOOD7OB_ORG_ID 或 config set org-id）';

/** X-Tenant-Id of a KB call is the organization id; the caller must be an active member. */
const tenantHeaders = (orgOption: string | undefined, extra: Record<string, string> = {}) => ({
  'X-Tenant-Id': String(resolveOrgId(orgOption, configService.get('orgId'))),
  ...extra,
});

/** /forge/kb/* answers with the bare entity (no envelope), hence apiClient.requestRaw. */
export function registerKbCommands(program: Command) {
  const kb = program.command('kb').description('知识库 — 列表、上传文件、把 PRD 同步进知识库');

  kb
    .command('list')
    .description('列出当前组织的知识库文档')
    .option('--source <type>', '来源 upload|prd|text 等')
    .option(ORG_OPTION, ORG_DESC)
    .option('--json', '输出 JSON')
    .action((o) =>
      guarded('获取知识库文档失败', {}, async () => {
        const docs: any[] = (await apiClient.requestRaw('get', '/forge/kb/documents', { params: o.source ? { sourceType: o.source } : undefined, headers: tenantHeaders(o.orgId) })) ?? [];
        emit(o.json, docs, () => {
          if (!docs.length) return '没有知识库文档。';
          const rows = [['ID', '名称', '来源', '状态', '产品', '更新'],
            ...docs.map((d) => [dash(d.id), dash(d.name), dash(d.sourceType), dash(d.status), dash(d.productId), fmtDateTime(d.createdAt)])];
          return `${renderTable(rows)}\n\n共 ${docs.length} 条`;
        });
      })
    );

  kb
    .command('upload <file>')
    .description('上传本地文件到产品知识库（嵌入费用由平台承担）')
    .requiredOption('--product-id <id>', '产品 ID')
    .option(ORG_OPTION, ORG_DESC)
    .option('--json', '输出 JSON')
    .action((file, o) =>
      guarded('上传知识库文档失败', {}, async () => {
        const productId = parseId(o.productId, '--product-id');
        const filePath = path.resolve(file);
        if (!fs.existsSync(filePath)) throw new InputError(`文件不存在: ${filePath}`);
        const form = new FormData();
        form.append('file', fs.readFileSync(filePath), path.basename(filePath));
        form.append('productId', String(productId));
        const doc = await apiClient.requestRaw('post', '/forge/kb/documents/upload', { data: form, headers: tenantHeaders(o.orgId, form.getHeaders()) });
        emit(o.json, doc, () => `✓ 已上传 ${dash(doc.name)}（文档 ID ${dash(doc.id)}，状态 ${dash(doc.status)}）`);
      })
    );

  kb
    .command('sync-prd <document-id>')
    .description('把 PRD 文档（prd get 的 ID）同步进产品知识库；重复同步会更新同一份文档')
    .requiredOption('--product-id <id>', '产品 ID')
    .option(ORG_OPTION, ORG_DESC)
    .option('--json', '输出 JSON')
    .action((documentId, o) =>
      guarded('同步 PRD 到知识库失败', {}, async () => {
        const prdId = parseId(documentId, 'document-id');
        const productId = parseId(o.productId, '--product-id');
        const prd = await apiClient.get(`/forge/prd/${prdId}`);
        const content = prd?.contentMd;
        if (!content) throw new InputError(`PRD ${prdId} 不存在或没有内容`);
        const doc = await apiClient.requestRaw('post', '/forge/kb/sync/prd', {
          data: { prdId, productId, title: prd.title ?? 'Untitled PRD', content },
          headers: tenantHeaders(o.orgId),
        });
        emit(o.json, doc, () => `✓ PRD ${prdId}「${dash(prd.title)}」已同步（知识库文档 ID ${dash(doc.id)}，状态 ${dash(doc.status)}）`);
      })
    );
}

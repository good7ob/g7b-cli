import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { dash, emit, guarded, InputError, parseId, renderTable, requireOneOf } from '../../utils/cliHelpers';

/** PRD library (prd-library contract): `prd list` / `prd bind` over /forge/prd/prds. */
export function registerLibraryCommands(prdCommand: Command) {
  prdCommand
    .command('list')
    .description('列出 PRD 文档库（按产品 / 未关联产品 / 来源 / 状态 / 关键字筛选）')
    .option('--product-id <id>', '只看该产品下的 PRD')
    .option('--unassigned', '只看未关联产品的 PRD（与 --product-id 互斥）')
    .option('--source <source>', '来源 import|chat')
    .option('--status <status>', '状态筛选')
    .option('--keyword <text>', '标题 / 编号模糊匹配')
    .option('-p, --page <num>', '页码', '1')
    .option('-l, --limit <num>', '每页条数', '20')
    .option('--json', '输出 JSON')
    .action((o) =>
      guarded('获取 PRD 列表失败', {}, async () => {
        if (o.productId && o.unassigned) throw new InputError('--product-id 与 --unassigned 不能同时使用');
        const params: Record<string, unknown> = {
          ...(o.productId ? { productId: parseId(o.productId, '--product-id') } : {}),
          ...(o.unassigned ? { unassigned: true } : {}),
          ...(o.source ? { source: requireOneOf(o.source, ['import', 'chat'] as const, '--source') } : {}),
          ...(o.status ? { status: o.status } : {}),
          ...(o.keyword ? { keyword: o.keyword } : {}),
          page: parseInt(o.page, 10) || 1,
          pageSize: parseInt(o.limit, 10) || 20,
        };
        const result = await apiClient.get('/forge/prd/prds', params);
        emit(o.json, result, () => {
          const list: any[] = result?.list ?? [];
          if (!list.length) return '没有找到 PRD。';
          const rows = [['PRD 编号', 'PRD ID', '标题', '状态', '产品', '来源', '会话数', '更新时间'],
            ...list.map((p) => [dash(p.prdNo), dash(p.prdId), dash(p.title), dash(p.status), dash(p.productName ?? p.productId),
              dash(p.source), String(p.sessionCount ?? 0), dash(p.updatedAt)])];
          return `${renderTable(rows)}\n\n共 ${result.total ?? list.length} 条，第 ${params.page} 页`;
        });
      })
    );

  prdCommand
    .command('bind <prd-id>')
    .description('把 PRD 绑定到产品（--product-id none 表示解绑）')
    .requiredOption('--product-id <id>', '产品 ID，或 none 解绑')
    .option('--sub-module-id <id>', '子模块 ID')
    .option('--json', '输出 JSON')
    .action((prdId, o) =>
      guarded('绑定 PRD 失败', {}, async () => {
        const id = parseId(prdId, 'prd-id');
        const unbind = o.productId === 'none';
        const body = unbind
          ? { productId: null }
          : {
              productId: parseId(o.productId, '--product-id'),
              ...(o.subModuleId ? { subModuleId: parseId(o.subModuleId, '--sub-module-id') } : {}),
            };
        const result = await apiClient.put(`/forge/prd/prds/${id}/product`, body);
        emit(o.json, result, () => (unbind ? `✓ PRD ${id} 已解除产品关联` : `✓ PRD ${id} 已关联产品 ${o.productId}`));
      })
    );
}

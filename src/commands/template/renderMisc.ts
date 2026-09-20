/** Renderers for categories, tags, reviews, packages and the admin review queue. */

import { ApiDate, DASH, dash, fmtDateTime, renderTable } from '../../utils/cliHelpers';
import { extractRecords } from '../../utils/extractRecords';
import { pageFooter } from './render';

interface CategoryVo {
  id?: number; code?: string | null; name?: string | null; templateType?: string | null; children?: CategoryVo[] | null;
}

function categoryLines(nodes: CategoryVo[], depth: number): string[] {
  return nodes.flatMap((c) => [
    `${'  '.repeat(depth)}#${dash(c.id)} ${dash(c.name)}  (${dash(c.code)}, ${dash(c.templateType)})`,
    ...categoryLines(c.children ?? [], depth + 1),
  ]);
}

export function renderCategories(result: unknown): string {
  const roots = extractRecords<CategoryVo>(result);
  return roots.length ? categoryLines(roots, 0).join('\n') : '没有分类。';
}

export function renderTags(result: unknown): string {
  const tags = extractRecords<{ id?: number; name?: string; kind?: string }>(result);
  if (!tags.length) return '没有标签。';
  return renderTable([['ID', '类型', '名称']].concat(tags.map((t) => [dash(t.id), dash(t.kind), dash(t.name)])));
}

interface ReviewVo {
  id?: number; templateId?: number; userId?: number; rating?: number | null; comment?: string | null; createdAt?: ApiDate; updatedAt?: ApiDate;
}

export function renderReviewList(result: unknown, pageNum: number, pageSize: number): string {
  const records = extractRecords<ReviewVo>(result);
  if (!records.length) return '暂无评价。';
  const rows = [['ID', '用户', '评分', '时间', '评论']].concat(
    records.map((r) => [dash(r.id), dash(r.userId), r.rating ? '★'.repeat(r.rating) : DASH, fmtDateTime(r.updatedAt ?? r.createdAt), dash(r.comment)])
  );
  return `${renderTable(rows, { 4: { truncate: 60 } })}\n${pageFooter(result, records, pageNum, pageSize)}`;
}

export function renderReviewSaved(r: ReviewVo, templateId: number): string {
  return `✓ 已评价模板 #${templateId}: ${r?.rating ? '★'.repeat(r.rating) : DASH}${r?.comment ? ` — ${r.comment}` : ''}`;
}

// ── packages ──

interface PackageItemVo {
  templateId?: number; templateName?: string | null; templateType?: string | null; templateStatus?: string | null;
  publishedVersion?: string | null; versionConstraint?: string | null;
}
export interface PackageVo {
  id: number; name?: string | null; description?: string | null; visibility?: string | null; status?: string | null;
  ownerType?: string | null; ownerId?: number | null; orgId?: number | null; pricingType?: string | null;
  isOfficial?: boolean | null; installCount?: number | null; instantiateCount?: number | null; canManage?: boolean | null;
  createdBy?: number | null; createdAt?: ApiDate; updatedAt?: ApiDate; items?: PackageItemVo[] | null;
}

export function renderPackageList(result: unknown, pageNum: number, pageSize: number): string {
  const records = extractRecords<PackageVo>(result);
  if (!records.length) return '没有模板包。';
  const rows = [['ID', '状态', '可见', '安装', '创建时间', '名称']].concat(
    records.map((p) => [String(p.id), dash(p.status), dash(p.visibility), dash(p.installCount), fmtDateTime(p.createdAt), `${p.isOfficial ? '★ ' : ''}${dash(p.name)}`])
  );
  return `${renderTable(rows, { 5: { truncate: 40 } })}\n${pageFooter(result, records, pageNum, pageSize)}`;
}

export function renderPackage(p: PackageVo): string {
  const items = p.items ?? [];
  const owner = p.orgId ? `组织 #${p.orgId}` : `${dash(p.ownerType)} #${dash(p.ownerId)}`;
  const lines = [
    `模板包 #${p.id}  ${p.isOfficial ? '★ ' : ''}${dash(p.name)}`,
    '─'.repeat(60),
    `状态:     ${dash(p.status)}    可见性: ${dash(p.visibility)}    所有者: ${owner}    定价: ${dash(p.pricingType)}`,
    `热度:     安装 ${dash(p.installCount)}  实例化 ${dash(p.instantiateCount)}    ${p.canManage ? '可管理' : '只读'}`,
    `时间:     创建 ${fmtDateTime(p.createdAt)} by ${dash(p.createdBy)}    更新 ${fmtDateTime(p.updatedAt)}`,
    ...(p.description ? ['', '描述:', p.description] : []),
    '',
  ];
  if (!items.length) return [...lines, `条目: ${DASH}`].join('\n');
  // name / type / status / version are null when the caller cannot see that template in the library
  const rows = [['模板', '名称', '类型', '状态', '已发布版本', '版本约束']].concat(
    items.map((i) => [`#${dash(i.templateId)}`, dash(i.templateName), dash(i.templateType), dash(i.templateStatus), dash(i.publishedVersion), dash(i.versionConstraint)])
  );
  return [...lines, `条目 (${items.length})`, renderTable(rows)].join('\n');
}

// ── admin ──

interface ModerationItemVo {
  versionId?: number; version?: string | null; submittedAt?: ApiDate; submittedBy?: number | null; templateId?: number;
  templateName?: string | null; templateType?: string | null; visibility?: string | null; templateStatus?: string | null;
}

export function renderReviewQueue(result: unknown, pageNum: number, pageSize: number): string {
  const records = extractRecords<ModerationItemVo>(result);
  if (!records.length) return '审核队列为空。';
  const rows = [['版本ID', '模板', '类型', '版本', '模板状态', '提交时间', '提交人', '名称']].concat(
    records.map((r) => [
      dash(r.versionId), `#${dash(r.templateId)}`, dash(r.templateType), dash(r.version), dash(r.templateStatus),
      fmtDateTime(r.submittedAt), dash(r.submittedBy), dash(r.templateName),
    ])
  );
  return `${renderTable(rows, { 7: { truncate: 40 } })}\n${pageFooter(result, records, pageNum, pageSize)}`;
}

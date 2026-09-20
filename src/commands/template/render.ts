import { ApiDate, DASH, dash, fmtDateTime, fmtNum, renderTable } from '../../utils/cliHelpers';
import { extractRecords, extractTotal } from '../../utils/extractRecords';
import { VersionVo, renderVersion } from './renderVersion';

export interface TagVo {
  id?: number | null;
  name?: string | null;
  kind?: string | null;
}

export interface TemplateCard {
  id: number;
  name?: string | null;
  templateType?: string | null;
  description?: string | null;
  categoryId?: number | null;
  visibility?: string | null;
  status?: string | null;
  ownerType?: string | null;
  ownerId?: number | null;
  orgId?: number | null;
  isOfficial?: boolean | null;
  pricingType?: string | null;
  price?: number | null;
  currency?: string | null;
  licenseType?: string | null;
  publishedVersion?: string | null;
  ratingAvg?: number | null;
  reviewCount?: number | null;
  favoriteCount?: number | null;
  installCount?: number | null;
  instantiateCount?: number | null;
  viewCount?: number | null;
  tags?: TagVo[] | null;
  favorited?: boolean | null;
  canManage?: boolean | null;
  suspendReason?: string | null;
  createdBy?: number | null;
  publishedAt?: ApiDate;
  createdAt?: ApiDate;
  updatedAt?: ApiDate;
}

export interface TemplateDetail extends TemplateCard {
  version?: VersionVo | null;
}

/** The backend answers 0.00 for a template nobody rated; that is "no rating", never a rating of 0. */
export const fmtRating = (t: Pick<TemplateCard, 'ratingAvg' | 'reviewCount'>): string =>
  t.reviewCount ? `${fmtNum(t.ratingAvg)} (${t.reviewCount})` : DASH;

const flag = (value: boolean | null | undefined, yes: string) => (value ? yes : '');

/** Paged footer shared by every list; `total` falls back to the page length when the server omits it. */
export function pageFooter(result: unknown, records: unknown[], pageNum: number, pageSize: number): string {
  const total = extractTotal(result, records);
  return `共 ${total} 条，第 ${pageNum}/${Math.max(1, Math.ceil(total / pageSize))} 页`;
}

export function renderTemplateList(result: unknown, pageNum: number, pageSize: number, empty = '没有符合条件的模板。'): string {
  const records = extractRecords<TemplateCard>(result);
  if (!records.length) return empty;
  const rows = [['ID', '类型', '状态', '可见', '版本', '评分', '安装', '名称']].concat(
    records.map((t) => [
      String(t.id), dash(t.templateType), dash(t.status), dash(t.visibility), dash(t.publishedVersion),
      fmtRating(t), dash(t.installCount), `${flag(t.isOfficial, '★ ')}${dash(t.name)}`,
    ])
  );
  return `${renderTable(rows, { 7: { truncate: 40 } })}\n${pageFooter(result, records, pageNum, pageSize)}`;
}

export function renderTemplateHeader(t: TemplateCard): string[] {
  const owner = t.orgId ? `组织 #${t.orgId}` : `${dash(t.ownerType)} #${dash(t.ownerId)}`;
  return [
    `模板 #${t.id}  ${flag(t.isOfficial, '★ ')}${dash(t.name)}`,
    '─'.repeat(60),
    `类型:     ${dash(t.templateType)}    状态: ${dash(t.status)}    可见性: ${dash(t.visibility)}    所有者: ${owner}`,
    `版本:     ${dash(t.publishedVersion)}    评分: ${fmtRating(t)}    许可: ${dash(t.licenseType)}    定价: ${dash(t.pricingType)}`,
    `热度:     安装 ${dash(t.installCount)}  实例化 ${dash(t.instantiateCount)}  收藏 ${dash(t.favoriteCount)}  浏览 ${dash(t.viewCount)}`,
    `标签:     ${t.tags?.length ? t.tags.map((g) => dash(g.name)).join(', ') : DASH}    分类: ${dash(t.categoryId)}`,
    `我的:     ${t.favorited ? '已收藏' : '未收藏'}    ${t.canManage ? '可管理' : '只读'}`,
    ...(t.suspendReason ? [`下架原因: ${t.suspendReason}`] : []),
    `时间:     发布 ${fmtDateTime(t.publishedAt)}    创建 ${fmtDateTime(t.createdAt)} by ${dash(t.createdBy)}    更新 ${fmtDateTime(t.updatedAt)}`,
    ...(t.description ? ['', '描述:', t.description] : []),
  ];
}

export function renderTemplateDetail(t: TemplateDetail): string {
  const lines = renderTemplateHeader(t);
  lines.push('', t.version ? renderVersion(t.version) : '（暂无可查看的版本）');
  return lines.join('\n');
}

import { DASH, dash, fmtDateTime, renderTable } from '../../utils/cliHelpers';
import { extractRecords, extractTotal } from '../../utils/extractRecords';
import { CODE_TO_STATUS } from './input';

/** com.remostudio.blog.blog.model.entity.Blog (table blog_article). */
export interface Blog {
  uid: string;
  title?: string | null;
  summary?: string | null;
  content?: string | null;
  tagUid?: string | null;
  status?: number | null;
  adminUid?: number | null;
  author?: string | null;
  isPublish?: string | null;
  isOriginal?: string | null;
  collectCount?: number | null;
  clickNum?: number | null;
  createTime?: string | null;
  updateTime?: string | null;
  publishTime?: string | null;
}

function statusText(status: number | null | undefined): string {
  return status === null || status === undefined ? DASH : (CODE_TO_STATUS[status] ?? String(status));
}

export function renderBlogList(result: unknown, pageNum: number, pageSize: number): string {
  const records = extractRecords<Blog>(result);
  if (!records.length) return '没有符合条件的博客。';

  const rows = [['UID', '状态', '标题', '浏览', '收藏', '创建时间']].concat(
    records.map((b) => [
      dash(b.uid), statusText(b.status), dash(b.title), dash(b.clickNum), dash(b.collectCount), fmtDateTime(b.createTime),
    ])
  );
  const total = extractTotal(result, records);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return `${renderTable(rows, { 2: { truncate: 50 } })}\n共 ${total} 条，第 ${pageNum}/${pages} 页`;
}

export function renderBlogDetail(b: Blog): string {
  return [
    `${dash(b.uid)}  ${dash(b.title)}`,
    '─'.repeat(60),
    `状态: ${statusText(b.status)}    原创: ${b.isOriginal === '1' ? '是' : '否'}    发布: ${b.isPublish === '1' ? '是' : '否'}`,
    `作者: ${dash(b.author)} (${dash(b.adminUid)})    浏览: ${dash(b.clickNum)}    收藏: ${dash(b.collectCount)}`,
    `发布时间: ${fmtDateTime(b.publishTime)}    创建: ${fmtDateTime(b.createTime)}    更新: ${fmtDateTime(b.updateTime)}`,
    '',
    dash(b.content),
  ].join('\n');
}

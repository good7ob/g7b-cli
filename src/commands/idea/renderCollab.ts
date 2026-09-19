import { ApiDate, dash, fmtDate, fmtNum, renderTable } from '../../utils/cliHelpers';
import { extractRecords, extractTotal } from '../../utils/extractRecords';

export interface IdeaComment {
  id: number;
  ideaId?: number;
  authorId?: number | null;
  content?: string | null;
  parentId?: number | null;
  createdAt?: ApiDate;
}

export interface IdeaAttachment {
  id: number;
  ideaId?: number;
  fileName?: string | null;
  fileUrl?: string | null;
  contentType?: string | null;
  sizeBytes?: number | null;
  uploadedBy?: number | null;
  createdAt?: ApiDate;
}

export interface IdeaRelation {
  id: number;
  relationType?: string | null;
  direction?: string | null;
  otherIdeaId?: number | null;
  otherTitle?: string | null;
  otherStatus?: string | null;
  createdAt?: ApiDate;
}

export interface DuplicateCandidate {
  ideaId: number;
  title?: string | null;
  status?: string | null;
  similarity?: number | null;
}

export interface MergeResult {
  sourceIdeaId?: number | null;
  targetIdeaId?: number | null;
  movedSolutions?: number | null;
  movedComments?: number | null;
  movedAttachments?: number | null;
  movedTags?: number | null;
}

const wrap = (width: number) => ({ width, wrapWord: false });

export function renderComments(result: unknown, pageNum: number, pageSize: number): string {
  const records = extractRecords<IdeaComment>(result);
  if (!records.length) return '还没有评论。';
  const rows = [['ID', '作者', '回复', '时间', '内容']].concat(
    records.map((c) => [
      String(c.id), dash(c.authorId), c.parentId ? `#${c.parentId}` : '', fmtDate(c.createdAt), dash(c.content),
    ])
  );
  const total = extractTotal(result, records);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return `${renderTable(rows, { 4: wrap(60) })}\n共 ${total} 条，第 ${pageNum}/${pages} 页`;
}

/** 1536 -> "1.5 KB"; null -> —. */
export function fmtBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(Number(bytes))) return dash(null);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${fmtNum(bytes / 1024, ' KB', 1)}`;
  return `${fmtNum(bytes / 1024 / 1024, ' MB', 1)}`;
}

export function renderAttachments(list: IdeaAttachment[]): string {
  if (!list.length) return '还没有附件。';
  const rows = [['ID', '文件名', '类型', '大小', '登记人', '时间', '地址']].concat(
    list.map((a) => [
      String(a.id), dash(a.fileName), dash(a.contentType), fmtBytes(a.sizeBytes), dash(a.uploadedBy),
      fmtDate(a.createdAt), dash(a.fileUrl),
    ])
  );
  return `${renderTable(rows, { 1: wrap(30) })}\n共 ${list.length} 个`;
}

const ARROW: Record<string, string> = { outgoing: '→', incoming: '←' };

export function renderRelations(list: IdeaRelation[]): string {
  if (!list.length) return '没有关联的 Idea。';
  const rows = [['ID', '关系', '对方', '状态', '标题']].concat(
    list.map((r) => [
      String(r.id), `${ARROW[r.direction ?? ''] ?? '?'} ${dash(r.relationType)}`,
      dash(r.otherIdeaId === null || r.otherIdeaId === undefined ? null : `#${r.otherIdeaId}`),
      dash(r.otherStatus), dash(r.otherTitle),
    ])
  );
  return `${renderTable(rows, { 4: wrap(40) })}\n→ 本 Idea 指向对方，← 对方指向本 Idea`;
}

export function renderDuplicates(list: DuplicateCandidate[]): string {
  if (!list.length) return '没有疑似重复的 Idea。';
  const rows = [['ID', '相似度', '状态', '标题']].concat(
    list.map((d) => [String(d.ideaId), fmtNum(d.similarity), dash(d.status), dash(d.title)])
  );
  return renderTable(rows, { 3: wrap(50) });
}

export function renderMerge(id: number, targetId: number, r: MergeResult | null): string {
  return `✓ Idea #${id} 已合并到 #${targetId}（源已归档；迁移 方案 ${dash(r?.movedSolutions)} / 评论 ${dash(r?.movedComments)}` +
    ` / 附件 ${dash(r?.movedAttachments)} / 标签 ${dash(r?.movedTags)}）`;
}

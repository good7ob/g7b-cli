import { table } from 'table';
import { DASH, dash, fmtDateTime } from '../../utils/cliHelpers';

export interface ObjectFileVo {
  fileId: number;
  groupId: number;
  fileName: string;
  versionNo: number;
  sizeBytes: number | null;
  source: string;
  note: string | null;
  scanStatus: string;
  confidential: boolean;
  inKnowledgeBase?: boolean;
  referenced: boolean;
  ownerType: string;
  ownerId: number;
  retentionUntil: unknown;
  createdAt: unknown;
}

export interface ObjectFilePage {
  items: ObjectFileVo[];
  total: number;
  page: number;
  size: number;
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function fmtSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || bytes < 0) return DASH;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(value >= 10 ? 0 : 1)} ${UNITS[unit]}`;
}

const SCAN: Record<string, string> = { pending: '扫描中', clean: '正常', skipped: '正常', infected: '已隔离' };

function flags(f: ObjectFileVo): string {
  const out: string[] = [];
  if (f.referenced) out.push('引用');
  if (f.confidential) out.push('机密');
  if (f.inKnowledgeBase) out.push('知识库');
  if (f.retentionUntil) out.push('到期删除');
  return out.length ? out.join(' ') : DASH;
}

export function renderList(page: ObjectFilePage): string {
  const items = page?.items ?? [];
  if (items.length === 0) return '没有文件';
  const rows = [['ID', '文件名', '版本', '大小', '来源', '状态', '标记', '时间']];
  for (const f of items) {
    rows.push([
      String(f.fileId), f.fileName, `v${f.versionNo}`, fmtSize(f.sizeBytes), dash(f.source),
      SCAN[f.scanStatus] ?? dash(f.scanStatus), flags(f), fmtDateTime(f.createdAt),
    ]);
  }
  return `${table(rows)}共 ${page.total} 个，第 ${page.page} 页（每页 ${page.size}）`;
}

export function renderVersions(versions: ObjectFileVo[]): string {
  if (!versions || versions.length === 0) return '没有版本';
  const rows = [['ID', '版本', '大小', '状态', '时间']];
  for (const v of versions) {
    rows.push([String(v.fileId), `v${v.versionNo}`, fmtSize(v.sizeBytes), SCAN[v.scanStatus] ?? dash(v.scanStatus), fmtDateTime(v.createdAt)]);
  }
  return table(rows);
}

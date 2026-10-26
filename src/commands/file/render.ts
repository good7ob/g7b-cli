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

export interface AccessEntry {
  id: number;
  fileId: number;
  versionNo: number | null;
  action: string;
  actorId: number | null;
  channel: string;
  createdAt: unknown;
}

const ACTIONS: Record<string, string> = {
  upload: '上传', download: '下载', delete: '删除', restore: '恢复', reference: '引用', unreference: '取消引用',
  scan_infected: '扫描命中病毒', set_current: '设为当前版本', kb_on: '存入知识库', kb_off: '移出知识库',
  keep: '永久保留', confidential: '机密标记',
};

export function renderAccess(entries: AccessEntry[]): string {
  if (!entries || entries.length === 0) return '没有访问记录';
  const rows = [['时间', '操作', '版本', '操作者', '来源']];
  for (const e of entries) {
    rows.push([fmtDateTime(e.createdAt), ACTIONS[e.action] ?? e.action, e.versionNo === null ? DASH : `v${e.versionNo}`,
      e.actorId === null ? '系统' : `#${e.actorId}`, dash(e.channel)]);
  }
  return table(rows);
}

import { ApiDate, dash, fmtDateTime, fmtNum, renderTable } from '../../utils/cliHelpers';

export interface Release {
  id: number;
  productId?: number;
  name?: string | null;
  version?: string | null;
  description?: string | null;
  status?: string | null;
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
  releasedAt?: ApiDate;
  createdBy?: number | null;
  createdAt?: ApiDate;
  updatedAt?: ApiDate;
  taskCount?: number | null;
  /** Only present on detail and request-approval responses. */
  pendingApprovalId?: number | null;
}

export interface ReleaseTask {
  id: number;
  name?: string | null;
  status?: string | null;
  progress?: number | null;
  projectId?: number | null;
  responsibleId?: number | null;
}

export function renderReleaseList(releases: Release[]): string {
  if (!releases.length) return '没有符合条件的 Release。';
  const rows = [['ID', '状态', '版本', '名称', '任务', '计划开始', '计划结束']].concat(
    releases.map((r) => [
      String(r.id), dash(r.status), dash(r.version), dash(r.name), dash(r.taskCount),
      dash(r.plannedStartDate), dash(r.plannedEndDate),
    ])
  );
  return `${renderTable(rows, { 3: { truncate: 30 } })}\n共 ${releases.length} 个 Release`;
}

export function renderReleaseDetail(r: Release): string {
  const lines = [
    `Release #${r.id}  ${dash(r.name)}`,
    '─'.repeat(60),
    `状态:     ${dash(r.status)}    版本: ${dash(r.version)}    产品: ${dash(r.productId)}`,
    `计划:     ${dash(r.plannedStartDate)} → ${dash(r.plannedEndDate)}    发布于: ${fmtDateTime(r.releasedAt)}`,
    `任务数:   ${dash(r.taskCount)}（good7ob release tasks ${r.id}）`,
  ];
  if (r.pendingApprovalId) {
    lines.push(`待处理审批: #${r.pendingApprovalId}（good7ob approval get ${r.pendingApprovalId}）`);
  }
  lines.push(`创建:     ${fmtDateTime(r.createdAt)} by ${dash(r.createdBy)}    更新: ${fmtDateTime(r.updatedAt)}`);
  if (r.description) lines.push('', '描述:', r.description);
  return lines.join('\n');
}

export function renderReleaseTasks(tasks: ReleaseTask[]): string {
  if (!tasks.length) return '该 Release 还没有关联任务（用 release tasks add 添加）。';
  const rows = [['ID', '状态', '进度', '任务', '项目', '负责人']].concat(
    tasks.map((t) => [
      String(t.id), dash(t.status), fmtNum(t.progress, '%'), dash(t.name), dash(t.projectId), dash(t.responsibleId),
    ])
  );
  return `${renderTable(rows, { 3: { truncate: 40 } })}\n共 ${tasks.length} 个任务`;
}

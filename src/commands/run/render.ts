/**
 * Terminal rendering of runs, steps, log segments and stream events (backend #992 `RunQueryService` shapes).
 */

import { DASH, dash, fmtDateTime, fmtNum, renderTable, stripControl } from '../../utils/cliHelpers';

export function renderRunList(rows: any[], total?: number): string {
  if (!rows.length) return '没有运行（默认只查最近 90 天）';
  const table = renderTable([
    ['ID', '状态', '自动化', '项目', '步骤(成/败/行/等/总)', 'Token', '成本', '开始'],
    ...rows.map((r) => [
      String(r.id),
      runStatusLabel(r),
      `${dash(r.automationName)}${r.automationId != null ? ` #${r.automationId}` : ''}`,
      `${dash(r.projectName)}${r.projectId != null ? ` #${r.projectId}` : ''}`,
      stepCounts(r.steps),
      fmtNum(r.tokens?.total, '', 0),
      costText(r.cost),
      fmtDateTime(r.actualStartAt ?? r.scheduledStartAt),
    ]),
  ]);
  return total != null && total > rows.length ? `${table}\n共 ${total} 条（--page / --page-size 翻页）` : table;
}

function runStatusLabel(r: any): string {
  const s = r.status ?? r.planStatus ?? DASH;
  if (s === 'paused' && r.pauseKind) return `paused(${r.pauseKind})`;
  if (r.pausingSub) return `${s}(pausing)`;
  return s;
}

function stepCounts(s: any): string {
  if (!s) return DASH;
  return `${s.succeeded ?? 0}/${s.failed ?? 0}/${s.running ?? 0}/${s.waiting ?? 0}/${s.total ?? 0}`;
}

function costText(c: any): string {
  if (!c || c.amount == null) return DASH;
  return `${fmtNum(c.amount, '', 4)} ${c.currency ?? ''}${c.hasUnpriced ? '*' : ''}`.trim();
}

export function renderRunDetail(r: any): string {
  const lines = [
    `运行 #${r.id}  ${runStatusLabel(r)}  version ${dash(r.version)}`,
    `  自动化: ${dash(r.automationName)}${r.automationId != null ? ` #${r.automationId}` : ''}   项目: ${dash(r.projectName)}${r.projectId != null ? ` #${r.projectId}` : ''}`,
    `  触发: ${dash(r.trigger?.type)} ${fmtDateTime(r.trigger?.at, '')}   工作流: ${dash(r.workflow?.templateCode)} v${dash(r.workflow?.version)}   失败策略: ${dash(r.failurePolicy)}`,
    `  开始: ${fmtDateTime(r.actualStartAt ?? r.scheduledStartAt)}   结束: ${fmtDateTime(r.finishedAt)}   执行: ${dash(r.execSeconds)} s`,
    `  步骤: 成功 ${r.steps?.succeeded ?? 0} / 失败 ${r.steps?.failed ?? 0} / 执行中 ${r.steps?.running ?? 0} / 等待 ${r.steps?.waiting ?? 0} / 共 ${r.steps?.total ?? 0}`,
    `  Token: ${fmtNum(r.tokens?.total, '', 0)}（输入 ${fmtNum(r.tokens?.input, '', 0)} 输出 ${fmtNum(r.tokens?.output, '', 0)} 缓存读 ${fmtNum(r.tokens?.cacheRead, '', 0)} 缓存写 ${fmtNum(r.tokens?.cacheWrite, '', 0)}）  成本: ${costText(r.cost)}${r.cost?.budget != null ? `  预算 ${r.cost.budget}` : ''}`,
  ];
  if (r.waitingReason?.code) lines.push(`  等待原因: ${r.waitingReason.code}${r.waitingReason.hint ? ` — ${r.waitingReason.hint}` : ''}`);
  if (r.pausedReason) lines.push(`  暂停原因: ${r.pausedReason}`);
  if (r.note) lines.push(`  备注: ${r.note}`);
  const p = r.permissions;
  if (p) {
    const ops = [p.canPause && 'pause', p.canHalt && 'halt', p.canResume && 'resume', p.canCancel && 'cancel', p.canRetryFailed && 'step retry', p.canReassign && 'step reassign'].filter(Boolean);
    lines.push(`  可执行操作: ${ops.length ? ops.join(' / ') : '(无)'}`);
  }
  const steps: any[] = Array.isArray(r.stepList) ? r.stepList : [];
  if (steps.length) {
    lines.push('');
    lines.push(renderSteps(steps));
  }
  return lines.join('\n');
}

export function renderSteps(steps: any[]): string {
  return renderTable([
    ['步骤', '组', '节点', '尝试', '状态', '执行者', '任务', 'Token', '日志', '耗时', '说明'],
    ...steps.map((s) => [
      `#${s.id}`,
      dash(s.groupNo),
      `${dash(s.nodeCode)}${s.nodeName ? ` ${s.nodeName}` : ''}`,
      dash(s.attempt),
      s.status ?? DASH,
      s.employeeName ? `${s.employeeName}${s.runnerId != null ? ` @R${s.runnerId}` : ''}` : s.executorType ?? DASH,
      s.taskId != null ? `#${s.taskId}` : DASH,
      fmtNum(s.tokens?.total, '', 0),
      s.logBytes ? `${fmtBytes(s.logBytes)}${s.logTruncated ? '(截断)' : ''}` : DASH,
      s.execSeconds != null ? `${s.execSeconds}s` : DASH,
      truncate(s.failureCode ? `${s.failureCode}${s.failureMessage ? `: ${s.failureMessage}` : ''}` : s.summary ?? '', 60) || DASH,
    ]),
  ]);
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Log segment contents as they were stored; control characters stripped (untrusted text). */
export function renderSegments(items: any[]): string {
  return items.map((i) => stripControl(String(i.content ?? '')).replace(/\n$/, '')).filter((s) => s.length).join('\n');
}

export function renderEvent(e: any): string {
  const move = e.fromStatus || e.toStatus ? ` ${e.fromStatus ?? ''}→${e.toStatus ?? ''}` : '';
  return stripControl(`[${fmtDateTime(e.createdAt)}] ${e.type ?? 'EVENT'}${move}${e.message ? ` ${e.message}` : ''}`);
}

/** The step `run logs` shows when no --step is given: the running one, else the last with logs, else the last. */
export function pickStep(steps: any[]): any | undefined {
  const active = steps.filter((s) => s.status === 'running' || s.status === 'assigned');
  if (active.length) return active[active.length - 1];
  const withLogs = steps.filter((s) => Number(s.logBytes) > 0);
  if (withLogs.length) return withLogs[withLogs.length - 1];
  return steps[steps.length - 1];
}

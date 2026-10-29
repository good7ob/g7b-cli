import { ApiDate, AUTH_CODES, DASH, dash, describeError, fmtDateTime, renderTable } from '../../utils/cliHelpers';
import { extractRecords, extractTotal } from '../../utils/extractRecords';
import { AUTOMATION_ERROR_CODES, AUTOMATION_ERROR_KEYS, Billing, Budget, Target, TaskFilter, Trigger } from './input';

export interface LastRun { runId?: number | null; result?: string | null; reasonCode?: string | null; at?: ApiDate }
export interface RunRow {
  kind?: string; runId?: number | null; status?: string | null; triggerType?: string | null; reasonCode?: string | null;
  message?: string | null; at?: ApiDate; actualStartAt?: ApiDate; triggeredBy?: number | null; triggerChannel?: string | null;
}
export interface EventRow {
  id?: number; eventType?: string | null; reasonCode?: string | null; runId?: number | null; operatorType?: string | null;
  operatorId?: number | null; channel?: string | null; message?: string | null; createdAt?: ApiDate;
}
export interface Automation {
  id: number; orgId?: number; name?: string | null; description?: string | null; status?: string | null;
  pausedReason?: string | null; displayStatus?: string | null; trigger?: Trigger | null; nextRunAt?: ApiDate;
  target?: Target | null; failurePolicy?: string | null; budget?: Budget | null; billing?: Billing | null;
  lastRun?: LastRun | null; pendingApprovalId?: number | null; pendingChangeKind?: string | null;
  definitionVersion?: number | null; runnerWarning?: boolean | null; activeRunId?: number | null;
  permissions?: { canEdit?: boolean; canEnable?: boolean; canRun?: boolean; canDelete?: boolean } | null;
  recentRuns?: RunRow[] | null; recentEvents?: EventRow[] | null;
}

// ── Errors ──

/**
 * The backend answers `KEY: field: reason`; the key picks the message when one code means several things
 * (1001 = bad field or EVENT phase 2, 1006 = duplicate name). The server text is always kept after it.
 */
export function describeAutomationError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: unknown } | null)?.code;
  const key = /^([A-Z][A-Z0-9_]+):/.exec(message)?.[1];
  if (typeof code !== 'number' || !key || !AUTOMATION_ERROR_KEYS[key]) return describeError(error, AUTOMATION_ERROR_CODES);
  return describeError(error, { ...AUTH_CODES, ...AUTOMATION_ERROR_CODES, [code]: AUTOMATION_ERROR_KEYS[key] });
}

// ── Labels ──

const WEEKDAY_CN = ['', '一', '二', '三', '四', '五', '六', '日'];
const yesNo = (v: boolean | null | undefined) => (v === null || v === undefined ? DASH : v ? '是' : '否');
const DISPLAY: Record<string, string> = { RUNNING: '运行中', NEEDS_APPROVAL: '待审批' };

export function statusLabel(a: Pick<Automation, 'status' | 'displayStatus' | 'pausedReason'>): string {
  let s = dash(a.status);
  if (a.status === 'paused' && a.pausedReason) s += `(${a.pausedReason})`;
  const extra = a.displayStatus ? DISPLAY[a.displayStatus] : undefined;
  return extra && a.status !== 'awaiting_approval' ? `${s} · ${extra}` : s;
}

export function triggerLabel(t: Trigger | null | undefined): string {
  if (!t) return DASH;
  return t.display ? `${t.display}` : dash(t.type);
}

export function lastRunLabel(r: LastRun | null | undefined): string {
  if (!r || (!r.result && !r.runId)) return DASH;
  return [r.result ?? DASH, r.runId ? `#${r.runId}` : '', r.reasonCode ? `(${r.reasonCode})` : ''].filter(Boolean).join(' ');
}

const weekdays = (days?: number[]) => (days?.length ? '周' + days.map((d) => WEEKDAY_CN[d] ?? d).join('、') : '每天');
const project = (t: Target | null | undefined) =>
  t?.projectId ? `#${t.projectId}${t.projectName ? ' ' + t.projectName : ''}` : DASH;

function filterLabel(f: TaskFilter | null | undefined): string {
  const parts = [
    f?.labels?.length ? `标签 ${f.labels.join(',')}` : '',
    f?.priorities?.length ? `优先级 ${f.priorities.join(',')}` : '',
    f?.executorEmployeeId ? `指定 AI 员工 #${f.executorEmployeeId}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' / ') : '全部待 AI 执行任务';
}

const tokens = (n: number | null | undefined) => (n === null || n === undefined ? '不限' : `${n} Token`);

// ── list / show ──

export function renderAutomationList(result: unknown, page: number, pageSize: number): string {
  const records = extractRecords<Automation>(result);
  if (!records.length) return '没有符合条件的自动化。新建：good7ob automation create --name … --project <id> --trigger cron --cron "0 22 * * *"';
  const rows = [['ID', '名称', '状态', '触发方式', '下次运行', '最近结果', '项目']].concat(
    records.map((a) => [
      String(a.id), dash(a.name), statusLabel(a), triggerLabel(a.trigger), fmtDateTime(a.nextRunAt),
      lastRunLabel(a.lastRun), project(a.target),
    ])
  );
  const total = extractTotal(result, records);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return `${renderTable(rows, { 1: { truncate: 30 }, 3: { truncate: 30 }, 6: { truncate: 24 } })}\n共 ${total} 条，第 ${page}/${pages} 页`;
}

export function renderRunRows(rows: RunRow[]): string {
  return renderTable([['类型', '运行ID', '状态', '触发', '渠道', '原因', '时间', '开始于']].concat(
    rows.map((r) => [
      dash(r.kind), r.runId ? `#${r.runId}` : DASH, dash(r.status), dash(r.triggerType), dash(r.triggerChannel),
      dash(r.reasonCode ?? r.message), fmtDateTime(r.at), fmtDateTime(r.actualStartAt),
    ])
  ), { 5: { truncate: 40 } });
}

export function renderEventRows(rows: EventRow[]): string {
  return renderTable([['ID', '事件', '原因', '运行', '操作人', '渠道', '说明', '时间']].concat(
    rows.map((e) => [
      dash(e.id), dash(e.eventType), dash(e.reasonCode), e.runId ? `#${e.runId}` : DASH,
      e.operatorType ? `${e.operatorType}${e.operatorId ? ':' + e.operatorId : ''}` : DASH,
      dash(e.channel), dash(e.message), fmtDateTime(e.createdAt),
    ])
  ), { 6: { truncate: 40 } });
}

export function renderAutomationDetail(a: Automation): string {
  const t = a.trigger ?? undefined;
  const g = a.target ?? undefined;
  const b = a.budget ?? undefined;
  const bill = a.billing ?? undefined;
  const triggerTech = [
    t?.type,
    t?.cronExpr ? `cron ${t.cronExpr}` : '',
    t?.poolMinIntervalMinutes ? `最小间隔 ${t.poolMinIntervalMinutes} 分钟` : '',
    t?.timeZone ? `时区 ${t.timeZone}` : '',
  ].filter(Boolean).join('，');
  const lines = [
    `自动化 #${a.id}  ${dash(a.name)}`,
    '─'.repeat(60),
    `状态:     ${statusLabel(a)}    版本: ${dash(a.definitionVersion)}    失败策略: ${dash(a.failurePolicy)}`,
    `触发:     ${triggerLabel(t)}${triggerTech ? `（${triggerTech}）` : ''}`,
  ];
  if (t?.window) lines.push(`运行窗口: ${t.window.start}-${t.window.end} ${weekdays(t.window.weekdays)}`);
  lines.push(
    `宽限:     ${t?.graceMinutes ? `${t.graceMinutes} 分钟` : DASH}    连续跳过: ${dash(t?.consecutiveSkips)}`,
    `下次运行: ${fmtDateTime(a.nextRunAt)}`,
    `最近结果: ${lastRunLabel(a.lastRun)}${a.lastRun?.at ? ' @ ' + fmtDateTime(a.lastRun.at) : ''}`,
    `目标:     项目 ${project(g)}；${filterLabel(g?.taskFilter)}；每次最多 ${dash(g?.maxTasksPerRun)} 个任务` +
      (g?.matchingTaskCount !== undefined && g?.matchingTaskCount !== null ? `；当前匹配 ${g.matchingTaskCount} 个` : ''),
    `预算:     单次 ${tokens(b?.runTokenBudget)} / 当日 ${tokens(b?.dailyTokenBudget)}` +
      (b?.todayUsedTokens !== undefined ? `（今日已用 ${b.todayUsedTokens}）` : '') +
      `；步骤超时 ${dash(b?.stepTimeoutMinutes)} 分钟，运行超时 ${dash(b?.runTimeoutMinutes)} 分钟`,
    `计费:     ${dash(bill?.subject)}；启用人 ${bill?.enabledBy ? `${dash(bill.enabledByName)}(#${bill.enabledBy}) @ ${fmtDateTime(bill.enabledAt)}` : DASH}` +
      `；每次运行需审批 ${bill?.effectiveRunApproval === 'required' ? '是' : bill?.effectiveRunApproval ? '否' : DASH}` +
      (bill?.runApprovalSource ? `（${bill.runApprovalSource}）` : ''),
  );
  if (a.pendingApprovalId) lines.push(`审批中:   审批 #${a.pendingApprovalId}（${dash(a.pendingChangeKind)}）— good7ob approval get ${a.pendingApprovalId}`);
  if (a.activeRunId) lines.push(`进行中:   运行 #${a.activeRunId}`);
  if (a.runnerWarning) lines.push('⚠ 当前没有在线且有空槽的 Runner，到点会因 NO_RUNNER 跳过');
  const p = a.permissions;
  if (p) lines.push(`我能:     编辑 ${yesNo(p.canEdit)} / 启用 ${yesNo(p.canEnable)} / 运行 ${yesNo(p.canRun)} / 删除 ${yesNo(p.canDelete)}`);
  if (a.description) lines.push('', '说明:', a.description);

  const runs = (a.recentRuns ?? []).slice(0, 10);
  lines.push('', `最近运行（含跳过，最多 10 条）:`, runs.length ? renderRunRows(runs) : '  （暂无）');
  const events = (a.recentEvents ?? []).slice(0, 5);
  if (events.length) lines.push('', '最近事件（最多 5 条，全部用 automation events）:', renderEventRows(events));
  return lines.join('\n');
}

// ── actions ──

export function renderActionResult(a: Automation, done: string): string {
  if (a.status === 'awaiting_approval' && a.pendingApprovalId) {
    return `✓ 自动化 #${a.id} 已提交审批 #${a.pendingApprovalId}（${dash(a.pendingChangeKind)}），批准后生效 — good7ob approval get ${a.pendingApprovalId}`;
  }
  const extra = a.status === 'enabled' && a.billing?.subject
    ? `；计费 ${a.billing.subject}，单次上限 ${tokens(a.budget?.runTokenBudget)}，下次运行 ${fmtDateTime(a.nextRunAt)}`
    : '';
  return `✓ 自动化 #${a.id} ${done}（${statusLabel(a)}）${extra}`;
}

export interface RunResult { runId?: number; status?: string; taskIds?: number[] }

export function renderRunResult(id: number, r: RunResult): string {
  const lines = [`✓ 自动化 #${id} 已创建运行 #${dash(r.runId)}（执行计划 #${dash(r.runId)}），状态 ${dash(r.status)}`];
  if (r.taskIds?.length) lines.push(`  任务: ${r.taskIds.map((t) => '#' + t).join(', ')}`);
  if (r.status === 'awaiting_approval') lines.push('  该运行需审批：在审批中心批准后开始（good7ob approval list --mine）');
  return lines.join('\n');
}

// ── runs / events / plans ──

export function renderRuns(result: unknown, page: number): string {
  const rows = extractRecords<RunRow>(result);
  if (!rows.length) return page > 1 ? `第 ${page} 页没有记录。` : '还没有运行或跳过记录。';
  return `${renderRunRows(rows)}\n第 ${page} 页`;
}

export function renderEvents(result: unknown, page: number, pageSize: number): string {
  const rows = extractRecords<EventRow>(result);
  if (!rows.length) return '没有事件。';
  const total = extractTotal(result, rows);
  return `${renderEventRows(rows)}\n共 ${total} 条，第 ${page}/${Math.max(1, Math.ceil(total / pageSize))} 页`;
}

interface PlanRow {
  kind?: string; automation?: Automation; plan?: Record<string, unknown>; actions?: string[];
}

export function renderPlans(result: unknown, page: number, pageSize: number): string {
  const rows = extractRecords<PlanRow>(result);
  const summary = (result as { summary?: { needsApproval?: number; awaitingApprovalRuns?: number } } | null)?.summary;
  const tail = summary ? `\n待审批的自动化 ${dash(summary.needsApproval)} 个，待审批的运行 ${dash(summary.awaitingApprovalRuns)} 个` : '';
  if (!rows.length) return `没有计划。${tail}`;
  const table = [['来源', 'ID', '名称', '状态', '触发', '下次运行', '项目', '可操作']].concat(
    rows.map((r) => {
      if (r.kind === 'AUTOMATION' && r.automation) {
        const a = r.automation;
        return ['自动化', String(a.id), dash(a.name), statusLabel(a), triggerLabel(a.trigger), fmtDateTime(a.nextRunAt),
          project(a.target), (r.actions ?? []).join(',') || DASH];
      }
      const p = r.plan ?? {};
      return ['执行计划', dash(p.id), dash(p.name), dash(p.status), dash(p.trigger), fmtDateTime(p.nextRunAt as ApiDate),
        p.projectId ? `#${p.projectId}${p.projectName ? ' ' + p.projectName : ''}` : DASH, (r.actions ?? []).join(',') || DASH];
    })
  );
  const total = extractTotal(result, rows);
  return `${renderTable(table, { 2: { truncate: 30 }, 4: { truncate: 24 }, 6: { truncate: 24 } })}\n共 ${total} 条，第 ${page}/${Math.max(1, Math.ceil(total / pageSize))} 页${tail}`;
}

// ── preview / settings ──

export interface Preview {
  triggerType?: string; timeZone?: string; cronExpr?: string; display?: string; next?: string[]; nextLocal?: string[];
  inWindow?: boolean[]; note?: string;
}

export function renderPreview(p: Preview): string {
  const lines = [`触发: ${dash(p.display)}（${[p.triggerType, p.cronExpr ? `cron ${p.cronExpr}` : '', p.timeZone ? `时区 ${p.timeZone}` : ''].filter(Boolean).join('，')}）`];
  const next = p.next ?? [];
  if (!next.length) {
    lines.push('没有固定的触发时刻。');
  } else {
    lines.push(`接下来 ${next.length} 次触发:`, renderTable([['#', '平台时间 (JST)', '触发器时区', '在运行窗口内']].concat(
      next.map((t, i) => [String(i + 1), t, dash(p.nextLocal?.[i]), p.inWindow ? yesNo(p.inWindow[i]) : DASH])
    )));
  }
  if (p.note) lines.push(p.note);
  return lines.join('\n');
}

export function renderSettings(s: Record<string, unknown>): string {
  const ra = (s.runApproval ?? {}) as { effective?: string; source?: string; note?: string };
  const b = (v: unknown) => yesNo(v as boolean | null | undefined);
  return [
    `组织 #${dash(s.orgId)} 自动化设置${s.canEdit === false ? '（只读：仅 owner/admin 可修改）' : ''}`,
    '─'.repeat(60),
    `时区:               ${dash(s.timeZone)}`,
    `启用需审批:         ${b(s.enableRequiresApproval)}`,
    `每次运行需审批:     ${b(s.runApprovalRequired)}（生效: ${dash(ra.effective)}，来源 ${dash(ra.source)}）`,
    `运行审批超时:       ${dash(s.runApprovalTimeoutHours)} 小时`,
    `成员可编辑:         ${b(s.memberCanEdit)}`,
    `租约 / Runner 提醒: ${dash(s.leaseMinutes)} 分钟 / ${dash(s.runnerReminderMinutes)} 分钟`,
    `日志保留:           ${dash(s.logRetentionDays)} 天    步骤重试上限: ${dash(s.stepRetryLimit)}    按 Token 均衡: ${b(s.balanceByTokens)}`,
    ...(ra.note ? [`注: ${ra.note}`] : []),
  ].join('\n');
}

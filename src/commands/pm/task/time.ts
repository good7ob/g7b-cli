import { Command } from 'commander';
import apiClient from '../../../services/ApiClient';
import {
  collect, checkMaxLength, dash, emit, ErrorCodeMap, fmtDateTime, fmtNum, guarded, InputError, parseId,
  parseDate, renderTable, requireOneOf, requireText,
} from '../../../utils/cliHelpers';
import {
  Allocation, fmtDuration, fmtRatio, hoursToSeconds, newSessionId, parseAllocations, parseCount, parseDuration, parseInstant,
} from './timeFormat';

/** api-0129 §3: business errors come back as HTTP 200 + code. */
const CODES: ErrorCodeMap = {
  1000: '缺少必填项（如 reason / sessionId / 任务）',
  1001: '参数不合法（负数、时间倒置、Token 总数与拆分不符、reason 超长、权重 ≤ 0、任务重复、不允许的 source）',
  1006: '该实绩已作废或来源优先级更高，不能被覆盖',
  1007: '操作不允许（非人工来源不能改 / 会话下有未带的任务须用 reallocate / 已作废）',
  1009: '并发修订冲突，请重试',
  2000: '任务/实绩/会话不存在，或你无权访问',
};
const SOURCES = ['human', 'ai', 'fp_model', 'assessment'] as const;
const SOURCE_TYPES = ['manual', 'hook_trace'] as const;
const EXECUTORS = ['HUMAN', 'AGENT'] as const;
const MAX_TEXT = 500;
const costNote = (visible: boolean | undefined) => (visible === false ? '（无成本权限，成本字段已隐藏）' : '');
const usd = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `$${fmtNum(v, '', 4)}`);
const tok = (v: number | null | undefined) => (v === null || v === undefined ? '—' : String(v));

// ── E1 render ──
function renderSummary(id: number, d: any): string {
  const e = d.estimate;
  const a = d.actual ?? {};
  const dev = d.deviation ?? {};
  const cost = d.costVisible !== false;
  const lines = [`任务 #${id} 估算 vs 实绩`];
  lines.push(e
    ? `估算(第${e.revisionNo}版/${dash(e.source)}): 时间 ${fmtDuration(e.seconds)}  Token ${tok(e.tokens)}${cost ? `  成本 ${usd(e.costUsd)}  Credits ${dash(e.credits)}` : ''}`
    : '估算: 无（从未估算或已清空）');
  lines.push(`实绩: 工作 ${fmtDuration(a.workSeconds)}（墙钟 ${fmtDuration(a.wallSeconds)}）  Token ${tok(a.tokens)}（不含缓存 ${tok(a.tokensNoCache)}）  记录 ${a.effortCount ?? 0} 条`
    + (cost ? `\n      成本 ${usd(a.costUsd)}  Credits ${dash(a.credits)}  BYOK 推算 ${usd(a.byokInferredCostUsd)}` : ''));
  if (a.unknownTimeCount) lines.push(`! 有 ${a.unknownTimeCount} 条实绩时间未知，工作时间不完整`);
  if (a.reworkWorkSeconds) lines.push(`  其中返工 ${fmtDuration(a.reworkWorkSeconds)}`);
  lines.push(`偏差: 时间 ${fmtRatio(dev.time)}  Token ${fmtRatio(dev.token)}（不含缓存 ${fmtRatio(dev.tokenNoCache)}）${cost ? `  成本 ${fmtRatio(dev.costUsd)}  Credits ${fmtRatio(dev.credits)}` : ''}`);
  const b = d.tokenBudget;
  if (b?.limit) lines.push(`Token 预算: ${b.consumed}/${b.limit}（${fmtRatio(b.usageRatio)}）`);
  if (!cost) lines.push(costNote(false));
  return lines.join('\n');
}

function renderEstimates(items: any[], cost: boolean): string {
  if (!items.length) return '无估算记录';
  const head = ['版本', '来源', '时间', 'Token', ...(cost ? ['成本', 'Credits'] : []), '时间点', '原因'];
  return renderTable([head, ...items.map((i) => [
    `#${i.revisionNo}`, dash(i.source), fmtDuration(i.seconds), tok(i.tokens),
    ...(cost ? [usd(i.costUsd), dash(i.credits)] : []), fmtDateTime(i.createdAt), dash(i.reason),
  ])]);
}

function renderEfforts(d: any): string {
  const items: any[] = d.items ?? [];
  if (!items.length) return '无实绩记录';
  const cost = d.costVisible !== false;
  const head = ['ID', '来源', '执行者', '工作', '墙钟', 'Token', ...(cost ? ['成本'] : []), '分摊', '开始', '会话', ''];
  const rows = items.map((i) => [
    String(i.id), dash(i.sourceType), dash(i.agentName ?? i.executorType), `${fmtDuration(i.workSeconds)}${i.workBasis && i.workBasis !== 'measured' ? `(${i.workBasis})` : ''}`,
    fmtDuration(i.wallClockSeconds), tok(i.tokensTotal), ...(cost ? [usd(i.providerCostUsd)] : []),
    `${dash(i.allocationRule)} ${i.allocationRatio ?? ''}`.trim(), fmtDateTime(i.startedAt), dash(i.sessionKey),
    [i.isDeleted && '已作废', i.isRework && '返工'].filter(Boolean).join(','),
  ]);
  return `${renderTable([head, ...rows])}\n共 ${d.total ?? items.length} 条（第 ${d.page ?? 1} 页）${costNote(d.costVisible)}`;
}

function renderWrite(d: any): string {
  const rows: any[] = d.rows ?? [];
  return [`会话 ${d.sessionKey}`, ...rows.map((r) =>
    `  #${r.effortId} 任务 ${r.taskId}  ${r.created ? '新增' : '覆盖'}  工作 ${fmtDuration(r.workSeconds)}  墙钟 ${fmtDuration(r.wallClockSeconds)}  Token ${tok(r.tokensTotal)}  占比 ${r.allocationRatio}`)].join('\n');
}

// ── request builders (pure, exported for tests) ──
export function buildEstimateBody(o: Record<string, any>): Record<string, unknown> {
  const reason = requireText(o.reason, MAX_TEXT, '--reason');
  if (o.hours !== undefined && o.seconds !== undefined) throw new InputError('--hours 与 --seconds 只能给一个');
  const body: Record<string, unknown> = { reason };
  if (o.hours !== undefined) body.seconds = hoursToSeconds(o.hours, '--hours');
  if (o.seconds !== undefined) body.seconds = parseCount(o.seconds, '--seconds');
  if (o.tokens !== undefined) body.tokens = parseCount(o.tokens, '--tokens');
  if (o.inputTokens !== undefined) body.inputTokens = parseCount(o.inputTokens, '--input-tokens');
  if (o.outputTokens !== undefined) body.outputTokens = parseCount(o.outputTokens, '--output-tokens');
  if (o.model !== undefined) body.modelCode = o.model;
  if (Object.keys(body).length === 1) throw new InputError('至少给一个估算维度：--hours/--seconds/--tokens/--input-tokens/--output-tokens');
  if (body.tokens !== undefined && body.inputTokens !== undefined && body.outputTokens !== undefined
    && body.tokens !== (body.inputTokens as number) + (body.outputTokens as number)) {
    throw new InputError('--tokens 必须等于 --input-tokens + --output-tokens（或只给其中一部分）');
  }
  if (o.source !== undefined) {
    body.source = requireOneOf(o.source, SOURCES, '--source');
    if (['fp_model', 'assessment'].includes(o.source) && !o.sourceRef) throw new InputError(`--source ${o.source} 必须同时给 --source-ref`);
  }
  if (o.sourceRef !== undefined) body.sourceRef = o.sourceRef;
  return body;
}

export function buildEffortBody(o: Record<string, any>): Record<string, unknown> {
  const allocations = parseAllocations(o.task);
  if (o.work === undefined && o.wall === undefined && o.startedAt === undefined) {
    throw new InputError('至少给 --work（如 1h30m），或 --wall / --started-at 与 --ended-at，否则时间未知');
  }
  const body: Record<string, unknown> = {
    sourceType: requireOneOf(o.sourceType ?? 'manual', SOURCE_TYPES, '--source-type'),
    sessionId: checkMaxLength(o.sessionId ?? newSessionId(), 100, '--session-id'),
  };
  if (allocations.length === 1 && allocations[0].weight === undefined) body.taskId = allocations[0].taskId;
  else body.allocations = allocations;
  if (o.executorType !== undefined) body.executorType = requireOneOf(o.executorType.toUpperCase(), EXECUTORS, '--executor-type');
  if (o.agent !== undefined) body.agentName = checkMaxLength(o.agent, 50, '--agent');
  if (o.work !== undefined) body.workSeconds = parseDuration(o.work, '--work');
  if (o.wall !== undefined) body.wallClockSeconds = parseDuration(o.wall, '--wall');
  if (o.startedAt !== undefined) body.startedAt = parseInstant(o.startedAt, '--started-at');
  if (o.endedAt !== undefined) body.endedAt = parseInstant(o.endedAt, '--ended-at');
  if (typeof body.startedAt === 'number' && typeof body.endedAt === 'number' && body.endedAt < body.startedAt) {
    throw new InputError('--ended-at 不能早于 --started-at');
  }
  const counts: Array<[string, string, string]> = [
    ['inputTokens', 'inputTokens', '--input-tokens'], ['outputTokens', 'outputTokens', '--output-tokens'],
    ['cacheReadTokens', 'cacheReadTokens', '--cache-read-tokens'], ['cacheWriteTokens', 'cacheWriteTokens', '--cache-write-tokens'],
    ['linesAdded', 'linesAdded', '--lines-added'], ['linesDeleted', 'linesDeleted', '--lines-deleted'], ['docChars', 'docChars', '--doc-chars'],
  ];
  counts.forEach(([opt, key, label]) => { if (o[opt] !== undefined) body[key] = parseCount(o[opt], label); });
  if (o.model !== undefined) body.modelCode = checkMaxLength(o.model, 100, '--model');
  if (o.byok) body.byok = true;
  if (o.pr?.length) body.prRefs = o.pr;
  if (o.rework) body.isRework = true;
  if (o.note !== undefined) body.note = checkMaxLength(o.note, MAX_TEXT, '--note');
  return body;
}

const toApiAllocations = (a: Allocation[]) => a.map((x) => (x.weight === undefined ? { taskId: x.taskId } : x));
const taskId = (arg: string) => parseId(arg, 'task-id');

export function registerTimeCommands(task: Command) {
  const run = (prefix: string, fn: () => Promise<void>) => guarded(prefix, CODES, fn);

  task.command('time <id>')
    .description('Estimate vs actual (time / tokens / cost) and deviation ratios for a task')
    .option('--json', 'Output as JSON')
    .action((idArg, o) => run('查询任务时间汇总失败', async () => {
      const id = taskId(idArg);
      const d = await apiClient.get(`/progress/tasks/${id}/time-summary`);
      emit(o.json, d, () => renderSummary(id, d));
    }));

  const estimate = task.command('estimate').description('Task estimate revisions — list, set, clear');
  estimate.command('list <id>').description('Estimate revision history (newest first)').option('--json', 'Output as JSON')
    .action((idArg, o) => run('查询估算历史失败', async () => {
      const d = await apiClient.get(`/progress/tasks/${taskId(idArg)}/estimates`);
      emit(o.json, d, () => renderEstimates(d.items ?? [], d.costVisible !== false) + (d.costVisible === false ? `\n${costNote(false)}` : ''));
    }));
  estimate.command('set <id>').description('Append an estimate revision (only the dimensions you give change)')
    .option('--hours <h>', 'Estimated hours (decimals ok; converted to integer seconds)')
    .option('--seconds <n>', 'Estimated seconds (integer; use instead of --hours)')
    .option('--tokens <n>', 'Estimated total tokens').option('--input-tokens <n>', 'Estimated input tokens')
    .option('--output-tokens <n>', 'Estimated output tokens').option('--model <code>', 'Model code used for cost estimation')
    .option('--source <source>', `Source: ${SOURCES.join(' | ')} (default human)`).option('--source-ref <ref>', 'Required for fp_model / assessment')
    .requiredOption('--reason <text>', `Why (max ${MAX_TEXT} chars)`).option('--json', 'Output as JSON')
    .action((idArg, o) => run('设置估算失败', async () => {
      const id = taskId(idArg);
      const body = buildEstimateBody(o);
      const d = await apiClient.post(`/progress/tasks/${id}/estimates`, body);
      emit(o.json, d, () => `✓ 任务 #${id} 估算已更新\n${renderEstimates([d.estimate], d.costVisible !== false)}`);
    }));
  estimate.command('clear <id>').description('Clear the estimate (appends an empty revision)')
    .requiredOption('--reason <text>', `Why (max ${MAX_TEXT} chars)`).option('--json', 'Output as JSON')
    .action((idArg, o) => run('清空估算失败', async () => {
      const id = taskId(idArg);
      const d = await apiClient.post(`/progress/tasks/${id}/estimates`, { clear: true, reason: requireText(o.reason, MAX_TEXT, '--reason') });
      emit(o.json, d, () => `✓ 任务 #${id} 估算已清空`);
    }));

  const effort = task.command('effort').description('Task effort records — list, add, void, reallocate');
  effort.command('list <id>').description('Effort records of a task (newest first)')
    .option('--page <n>', 'Page', '1').option('--size <n>', 'Page size (max 200)', '20')
    .option('--include-deleted', 'Include voided rows (owner/admin only)').option('--json', 'Output as JSON')
    .action((idArg, o) => run('查询实绩失败', async () => {
      const size = parseCount(o.size, '--size');
      if (size < 1 || size > 200) throw new InputError(`--size 必须在 1 到 200 之间，收到: ${o.size}`);
      const params: Record<string, unknown> = { page: Math.max(1, parseCount(o.page, '--page')), size };
      if (o.includeDeleted) params.includeDeleted = true;
      const d = await apiClient.get(`/progress/tasks/${taskId(idArg)}/efforts`, params);
      emit(o.json, d, () => renderEfforts(d));
    }));
  effort.command('add').description('Report one session of work, optionally spanning several tasks (re-running with the same --session-id overwrites)')
    .requiredOption('--task <id[:weight]>', 'Task id, optionally :weight; repeatable (weights all-or-none)', collect, [])
    .option('--work <dur>', 'Work time of the whole session, e.g. 1h30m / 90m / 45s').option('--wall <dur>', 'Wall-clock time of the session')
    .option('--started-at <t>', 'Start (epoch ms or ISO; no zone = JST)').option('--ended-at <t>', 'End (epoch ms or ISO)')
    .option('--input-tokens <n>').option('--output-tokens <n>').option('--cache-read-tokens <n>').option('--cache-write-tokens <n>')
    .option('--model <code>', 'Model code').option('--byok', 'Own subscription / local agent (cost inferred, not billed)')
    .option('--lines-added <n>').option('--lines-deleted <n>').option('--doc-chars <n>')
    .option('--pr <ref>', 'PR reference, e.g. good7ob/backend#812; repeatable', collect, [])
    .option('--rework', 'Mark as rework').option('--session-id <id>', 'Idempotency id of the session (default: random uuid)')
    .option('--source-type <type>', `${SOURCE_TYPES.join(' | ')} (default manual; hooks use hook_trace)`)
    .option('--executor-type <type>', 'HUMAN | AGENT').option('--agent <name>', 'Agent name, e.g. claude-code')
    .option('--note <text>', `Note (max ${MAX_TEXT} chars)`).option('--json', 'Output as JSON')
    .action((o) => run('上报实绩失败', async () => {
      const body = buildEffortBody(o);
      const d = await apiClient.post('/progress/efforts', body);
      emit(o.json, d, () => `✓ 实绩已上报\n${renderWrite(d)}${costNote(d.costVisible)}`);
    }));
  effort.command('void <effortId>').description('Void (soft-delete) an effort row')
    .requiredOption('--reason <text>', `Why (max ${MAX_TEXT} chars)`).option('--json', 'Output as JSON')
    .action((idArg, o) => run('作废实绩失败', async () => {
      const id = parseId(idArg, 'effortId');
      const reason = requireText(o.reason, MAX_TEXT, '--reason');
      const d = await apiClient.delete(`/progress/efforts/${id}?reason=${encodeURIComponent(reason)}`);
      emit(o.json, d, () => `✓ 实绩 #${d?.effortId ?? id} 已作废（任务 #${d?.taskId ?? '?'}）`);
    }));
  effort.command('reallocate <sessionKey>').description('Re-split a session over a new task list / weights')
    .requiredOption('--task <id[:weight]>', 'Task id, optionally :weight; repeatable', collect, [])
    .requiredOption('--reason <text>', `Why (max ${MAX_TEXT} chars)`).option('--json', 'Output as JSON')
    .action((key, o) => run('重新分摊失败', async () => {
      const body = { allocations: toApiAllocations(parseAllocations(o.task)), reason: requireText(o.reason, MAX_TEXT, '--reason') };
      if (!key.trim()) throw new InputError('sessionKey 不能为空');
      const d = await apiClient.post(`/progress/efforts/sessions/${encodeURIComponent(key)}/reallocate`, body);
      emit(o.json, d, () => `✓ 已重新分摊\n${renderWrite(d)}`);
    }));
}

export function registerTimeDeviationCommand(project: Command) {
  project.command('time-deviation <projectId>')
    .description('Estimate-vs-actual deviation per task in a project (only tasks with an estimate or effort)')
    .option('--executor-type <type>', 'HUMAN | AGENT').option('--completed-from <date>', 'yyyy-MM-dd').option('--completed-to <date>', 'yyyy-MM-dd')
    .option('--only-completed', 'Only completed tasks').option('--page <n>', 'Page', '1').option('--size <n>', 'Page size (max 200)', '50')
    .option('--json', 'Output as JSON')
    .action((idArg, o) => guarded('查询项目时间偏差失败', CODES, async () => {
      const id = parseId(idArg, 'projectId');
      const size = parseCount(o.size, '--size');
      if (size < 1 || size > 200) throw new InputError(`--size 必须在 1 到 200 之间，收到: ${o.size}`);
      const params: Record<string, unknown> = { page: Math.max(1, parseCount(o.page, '--page')), size };
      if (o.executorType !== undefined) params.executorType = requireOneOf(o.executorType.toUpperCase(), EXECUTORS, '--executor-type');
      if (o.completedFrom !== undefined) params.completedFrom = parseDate(o.completedFrom, '--completed-from');
      if (o.completedTo !== undefined) params.completedTo = parseDate(o.completedTo, '--completed-to');
      if (o.onlyCompleted) params.onlyCompleted = true;
      const d = await apiClient.get(`/progress/projects/${id}/time-deviation`, params);
      emit(o.json, d, () => renderDeviation(d));
    }));
}

function renderDeviation(d: any): string {
  const items: any[] = d.items ?? [];
  if (!items.length) return '无任务（只列有估算或有实绩的任务）';
  const cost = d.costVisible !== false;
  const head = ['任务', '名称', '状态', '估算', '实绩', '时间偏差', 'Token偏差', ...(cost ? ['成本偏差'] : [])];
  const rows = items.map((i) => [`#${i.taskId}`, dash(i.name), dash(i.status), fmtDuration(i.estimatedSeconds),
    fmtDuration(i.actualWorkSeconds), fmtRatio(i.timeDeviation), fmtRatio(i.tokenDeviation), ...(cost ? [fmtRatio(i.costDeviationUsd)] : [])]);
  return `${renderTable([head, ...rows])}\n共 ${d.total ?? items.length} 个任务（第 ${d.page ?? 1} 页）${costNote(d.costVisible)}`;
}

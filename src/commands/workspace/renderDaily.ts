import { ApiDate, DASH, dash, fmtDateTime } from '../../utils/cliHelpers';
import { ACTION_LABELS } from './render';

/** Renderers for `workspace daily-report` and `workspace next-actions` (api-0089 §8, §9). */

export interface DailyReport {
  date?: string | null;
  source?: string | null;
  generatedAt?: ApiDate;
  content?: string | null;
  /** Structured sections; shown only with --json. */
  sections?: { degraded?: string[] | null } & Record<string, unknown> | null;
  aiWarning?: string | null;
}

export interface NextAction {
  kind?: string | null;
  itemId?: number | null;
  taskId?: number | null;
  sourceType?: string | null;
  sourceId?: number | null;
  actionType?: string | null;
  title?: string | null;
  priority?: string | null;
  dueAt?: ApiDate;
  productId?: number | null;
  orgId?: number | null;
  score?: number | null;
  reasons?: string[] | null;
  factors?: { code?: string; points?: number }[] | null;
}

export interface NextActions {
  total?: number | null;
  items?: NextAction[] | null;
}

const KINDS: Record<string, string> = { QUEUE_ITEM: '队列项', TASK: '任务' };

const SOURCES: Record<string, string> = { template: 'template（确定性）', ai: 'ai' };

/** `generated`: shown right after `daily-report generate`, so the header says it was (re)generated. */
export function renderDailyReport(r: DailyReport, generated = false): string {
  const ai = r.source === 'ai';
  const lines = [
    `${generated ? '✓ 日报已生成  ' : ''}日报 ${dash(r.date)}    来源 ${SOURCES[r.source ?? ''] ?? dash(r.source)}    生成于 ${fmtDateTime(r.generatedAt)}`,
  ];
  if (ai) lines.push('含 AI 叙述总结（AI 生成，需人工确认；数字来自确定性数据，不会自动执行任何动作）');
  if (r.aiWarning) lines.push(`⚠ 未能使用 AI：${r.aiWarning}（已降级为确定性日报）`);
  const degraded = r.sections?.degraded ?? [];
  if (degraded.length) lines.push(`⚠ 部分分节加载失败（该节为空）: ${degraded.join(', ')}`);
  lines.push('─'.repeat(60), r.content ? r.content : '（日报没有正文）');
  return lines.join('\n');
}

function actionBlock(a: NextAction, index: number): string[] {
  const where = [
    a.itemId ? `队列项 #${a.itemId}` : null,
    a.taskId ? `任务 #${a.taskId}` : null,
    a.actionType ? (ACTION_LABELS[a.actionType] ?? a.actionType) : null,
    `优先级 ${dash(a.priority)}`,
    `到期 ${fmtDateTime(a.dueAt)}`,
  ].filter(Boolean);
  const reasons = a.reasons?.length ? a.reasons : [DASH];
  return [
    `${index + 1}. 得分 ${dash(a.score)}  ${dash(a.title)}    [${KINDS[a.kind ?? ''] ?? dash(a.kind)}]`,
    `   ${where.join(' · ')}`,
    ...reasons.map((reason) => `   · ${reason}`),
  ];
}

export function renderNextActions(n: NextActions): string {
  const items = n.items ?? [];
  if (!items.length) return `现在没有需要你处理的事项（候选 ${dash(n.total)} 个）。`;
  return [
    `下一步推荐（候选 ${dash(n.total)} 个，显示前 ${items.length} 个；得分越高越该先做，确定性规则、无 AI）`,
    '',
    ...items.flatMap((a, i) => [...actionBlock(a, i), '']),
    '队列项可用 `good7ob workspace queue approve|reject|dismiss|snooze <队列项id>` 直接处理。',
  ].join('\n');
}

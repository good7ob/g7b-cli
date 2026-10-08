/**
 * CLI-boundary validation for `question` commands. Limits mirror QuestionCreateDto /
 * QuestionQueryDto so a bad value is rejected here instead of as a 1001 round-trip.
 */

import {
  ErrorCodeMap,
  InputError,
  parseId,
  parseIntInRange,
  requireOneOf,
  requireText,
} from '../../utils/cliHelpers';

export const TYPES = ['choice', 'text'] as const;
export const STATUSES = ['open', 'answered', 'pending_approval', 'approved', 'rejected', 'cancelled'] as const;
// Same values as the idea sources (backend IdeaSourceEnum).
export const SOURCES = [
  'customer', 'feedback', 'pm', 'dev', 'ai', 'ops', 'bug', 'competitor', 'market', 'management',
] as const;
export const MAX_PAGE_SIZE = 100;
const MIN_OPTIONS = 2;

export const QUESTION_ERROR_CODES: ErrorCodeMap = {
  1000: '缺少必填参数',
  1001: '参数值不合法（类型 / 来源 / 选项 / 任务不存在等，见上方信息）',
  1008: '缺少 id',
  1009: '该问题已被处理或状态已变化，请刷新后重试',
  2000: '无权操作：你不是该问题的负责人 / 所属组织成员',
};

export interface OptionInput { key: string; label: string; description?: string }

/** `key=label` or `key=label|description` -> option. */
export function parseOption(raw: string): OptionInput {
  const eq = raw.indexOf('=');
  if (eq < 1) throw new InputError(`--option 格式应为 key=文案[|说明]，收到: ${raw}`);
  const [label, description] = raw.slice(eq + 1).split('|', 2);
  const key = raw.slice(0, eq).trim();
  if (!label.trim()) throw new InputError(`--option 文案不能为空，收到: ${raw}`);
  return description?.trim()
    ? { key, label: label.trim(), description: description.trim() }
    : { key, label: label.trim() };
}

interface CreateFlags {
  title?: string; type?: string; source?: string; description?: string; option?: string[];
  product?: string; project?: string; task?: string; assignee?: string; needsApproval?: boolean;
}

export function buildCreateBody(o: CreateFlags): Record<string, unknown> {
  const questionType = requireOneOf(o.type ?? '', TYPES, '--type');
  const options = (o.option ?? []).map(parseOption);
  if (questionType === 'text' && options.length) throw new InputError('text 类型不能带 --option');
  if (questionType === 'choice') {
    if (options.length < MIN_OPTIONS) throw new InputError(`choice 类型至少需要 ${MIN_OPTIONS} 个 --option`);
    if (new Set(options.map((x) => x.key)).size !== options.length) throw new InputError('--option 的 key 不能重复');
  }
  const body: Record<string, unknown> = {
    title: requireText(o.title, 200, '--title'),
    questionType,
    source: requireOneOf(o.source ?? '', SOURCES, '--source'),
  };
  if (o.description !== undefined) body.description = o.description;
  if (options.length) body.options = options;
  if (o.product !== undefined) body.productId = parseId(o.product, '--product');
  if (o.project !== undefined) body.projectId = parseId(o.project, '--project');
  if (o.task !== undefined) body.taskId = parseId(o.task, '--task');
  if (o.assignee !== undefined) body.assigneeId = parseId(o.assignee, '--assignee');
  if (o.needsApproval) body.needsApproval = true;
  return body;
}

export function buildListParams(o: {
  assignee?: string; product?: string; project?: string; task?: string; status?: string; page?: string; pageSize?: string;
}): Record<string, string | number> {
  const params: Record<string, string | number> = {
    page: parseIntInRange(o.page ?? '1', '--page', 1, 1_000_000),
    pageSize: parseIntInRange(o.pageSize ?? '20', '--page-size', 1, MAX_PAGE_SIZE),
  };
  if (o.assignee !== undefined) params.assigneeId = parseId(o.assignee, '--assignee');
  if (o.product !== undefined) params.productId = parseId(o.product, '--product');
  if (o.project !== undefined) params.projectId = parseId(o.project, '--project');
  if (o.task !== undefined) params.taskId = parseId(o.task, '--task');
  if (o.status !== undefined) params.status = requireOneOf(o.status, STATUSES, '--status');
  return params;
}

export function buildAnswerBody(o: { option?: string; text?: string }): Record<string, string> {
  const body: Record<string, string> = {};
  if (o.option !== undefined) body.answerOptionKey = requireText(o.option, 64, '--option');
  if (o.text !== undefined) body.answerText = requireText(o.text, 4000, '--text');
  if (!Object.keys(body).length) throw new InputError('回答需要 --option <key>（choice）或 --text <文本>（text），至少给一个');
  return body;
}

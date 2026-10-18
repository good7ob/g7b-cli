import { dash, fmtDateTime, renderTable } from '../../utils/cliHelpers';

const CATEGORY: Record<string, string> = { PROCESS: '流程', CODE: '代码', COMMUNICATION: '沟通', TOOL: '工具', OTHER: '其他' };
const LEVEL: Record<string, string> = { STABLE: '稳定偏好', LOCAL: '局部习惯' };
const SOURCE: Record<string, string> = { MANUAL: '手动', AI_EXTRACTED: 'AI 提取', AI_GENERATE: 'AI 生成', AI_REVISE: 'AI 修订' };
const STATUS: Record<string, string> = { ENABLED: '启用', DISABLED: '停用', PENDING: '待确认', DRAFT: '草稿' };
const SCENE: Record<string, string> = { EVERY_DAY: '每天', SINGLE_TASK: '单任务' };
const CONFIDENCE: Record<string, string> = { HIGH: '高', MEDIUM: '中', LOW: '低' };

const label = (map: Record<string, string>, v: unknown) => (v ? map[String(v)] ?? String(v) : dash(v));
const oneLine = (s: unknown, max: number) => {
  const flat = String(s ?? '').replace(/\s+/g, ' ').trim();
  const chars = Array.from(flat);
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : flat;
};

export interface Habit {
  id: number; title: string; content: string; category: string; level: string; source: string; status: string;
  version: number; confidence?: string; evidence?: { sourceType: string; summary: string }[];
  createdAt?: number; updatedAt?: number;
}
export interface Step {
  id?: number; seq: number; title: string; description?: string; habits?: { id: number; title: string }[];
}
export interface Workflow {
  id: number; name: string; description?: string; scene: string; status: string; source?: string; isDefault?: boolean;
  steps?: Step[]; stepCount?: number; version: number; basis?: unknown; revision?: { changes?: Change[] };
  createdAt?: number; updatedAt?: number;
}
interface Change { type: string; before?: { title: string }; after?: { title: string } }
interface Grouped<T> { total?: number; groups?: { category?: string; scene?: string; items: T[] }[] }

export const flatten = <T>(data: Grouped<T> | null | undefined): T[] => (data?.groups ?? []).flatMap((g) => g.items ?? []);

export function renderHabits(data: Grouped<Habit>, pending = false): string {
  const items = flatten(data);
  if (items.length === 0) return pending ? '没有待确认的习惯候选' : '没有习惯条目';
  const head = pending
    ? ['ID', '分类', '标题', '层级', '置信度', '证据', '版本']
    : ['ID', '分类', '标题', '层级', '来源', '状态', '版本'];
  const rows = items.map((h) => [
    String(h.id), label(CATEGORY, h.category), oneLine(h.title, 30), label(LEVEL, h.level),
    pending ? label(CONFIDENCE, h.confidence) : label(SOURCE, h.source),
    pending ? `${h.evidence?.length ?? 0} 条` : label(STATUS, h.status),
    String(h.version),
  ]);
  const detail = pending
    ? items.flatMap((h) => [`#${h.id} ${oneLine(h.content, 80)}`, ...(h.evidence ?? []).map((e) => `    · [${e.sourceType}] ${oneLine(e.summary, 100)}`)])
    : [];
  return [renderTable([head, ...rows]), `共 ${data.total ?? items.length} 条`, ...(detail.length ? ['', ...detail] : [])].join('\n');
}

export function renderHabit(h: Habit, verb: string): string {
  return `✓ 已${verb}习惯 #${h.id}「${oneLine(h.title, 40)}」 ${label(CATEGORY, h.category)}/${label(LEVEL, h.level)}，${label(STATUS, h.status)}，版本 ${h.version}`;
}

export function renderWorkflows(data: Grouped<Workflow>): string {
  const items = flatten(data);
  if (items.length === 0) return '没有工作流';
  const rows = items.map((w) => [
    String(w.id), label(SCENE, w.scene), oneLine(w.name, 30), label(STATUS, w.status), w.isDefault ? '默认' : '', `${w.stepCount ?? w.steps?.length ?? 0} 步`,
    String(w.version), fmtDateTime(w.updatedAt),
  ]);
  return [renderTable([['ID', '场景', '名称', '状态', '默认', '步骤', '版本', '更新时间(JST)'], ...rows]), `共 ${data.total ?? items.length} 个`].join('\n');
}

export function renderWorkflow(w: Workflow): string {
  const head = `#${w.id} ${w.name}  ${label(SCENE, w.scene)}  ${label(STATUS, w.status)}${w.isDefault ? '  默认' : ''}  版本 ${w.version}` +
    (w.source && w.source !== 'MANUAL' ? `  来源 ${label(SOURCE, w.source)}` : '');
  const meta = [w.description ? `说明：${oneLine(w.description, 200)}` : '', `更新：${fmtDateTime(w.updatedAt)} JST`].filter(Boolean);
  const steps = (w.steps ?? []).flatMap((s) => [
    `${s.seq}. ${s.title}${s.description ? `：${oneLine(s.description, 100)}` : ''}${s.id ? `  (步骤ID ${s.id})` : ''}`,
    ...(s.habits?.length ? [`     关联习惯：${s.habits.map((h) => h.title).join('、')}`] : []),
  ]);
  const changes = (w.revision?.changes ?? []).map((c) => {
    const tag = ({ ADDED: '新增', REMOVED: '删除', MODIFIED: '修改' } as Record<string, string>)[c.type] ?? c.type;
    return `  ${tag}：${c.after?.title ?? c.before?.title ?? ''}`;
  });
  return [head, ...meta, ...steps, ...(changes.length ? ['修订变更：', ...changes] : [])].join('\n');
}

export interface Usage { billed?: boolean; credits?: number }
export const renderUsage = (u?: Usage) => (u ? (u.billed ? `本次已扣除 ${u.credits ?? 0} 额度` : '本次未扣费（自带 Key）') : '');
export const statusLabel = (v: unknown) => label(STATUS, v);

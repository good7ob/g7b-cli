import { readFileSync } from 'fs';
import { createInterface } from 'readline';
import { parse as parseYaml } from 'yaml';
import { ErrorCodeMap, InputError, parseIntInRange, parseId, requireOneOf } from '../../utils/cliHelpers';

/**
 * 我的工作习惯 CLI（prd-0127 FP-7，api-0122 / api-0124）：参数只做边界校验，业务规则（重名、上限、乐观锁、
 * 草稿数量等）由后端保证。长度按 Unicode 字符数（code point）计。
 */

export const CATEGORIES = ['PROCESS', 'CODE', 'COMMUNICATION', 'TOOL', 'OTHER'] as const;
export const LEVELS = ['STABLE', 'LOCAL'] as const;
export const SOURCES = ['MANUAL', 'AI_EXTRACTED'] as const;
export const STATUSES = ['ENABLED', 'DISABLED', 'PENDING'] as const;
export const SCOPES = ['enabled', 'filtered'] as const;
export const MODES = ['replace', 'save-as-new'] as const;
/** CLI 场景词 -> 接口枚举 */
export const SCENES: Record<string, string> = { daily: 'EVERY_DAY', task: 'SINGLE_TASK' };
const EXTRACT_SOURCES = ['WORK_LOG', 'COMMIT', 'TASK'] as const;
const GENERATE_SOURCES = ['WORK_LOG', 'TASK'] as const;

/** 后端错误码 -> 中文提示（服务端原文附在方括号里）。 */
export const HABIT_ERROR_CODES: ErrorCodeMap = {
  1001: '参数不合法',
  1002: '数据不存在或不属于你',
  1006: '已存在同名数据，或该建议已有未处理的修订草稿',
  1007: '当前状态不支持该操作',
  1009: '内容已被其他窗口修改，请刷新（重新读取）后重试',
  1016: '请不要重复提交，上一次请求仍在处理',
  1017: '已达数量上限，请先清理',
  2000: '暂无权限（AI 员工身份不能使用本功能）',
  4015: 'AI 余额不足，请充值或配置自己的 API Key 后重试（本次未生成）',
  9011: 'AI 服务暂时不可用或超时，请稍后重试（本次未扣费）',
};

export const AI_TIMEOUT_HINT = '服务端可能仍在处理并已计费，先用 list / candidates / workflow draft list 核对，不要盲目重试';

const cpLen = (s: string) => Array.from(s).length;

export function oneOf<T extends string>(raw: string, allowed: readonly T[], label: string): T {
  return requireOneOf(raw.trim().toUpperCase(), allowed, label);
}

/** trim 后 1..max 字符；optional 时空值返回 undefined。 */
export function text(raw: string | undefined, max: number, label: string): string {
  const v = (raw ?? '').trim();
  if (!v) throw new InputError(`${label} 不能为空`);
  if (cpLen(v) > max) throw new InputError(`${label} 最多 ${max} 字，当前 ${cpLen(v)} 字`);
  return v;
}

function optText(raw: string | undefined, max: number, label: string): string | undefined {
  if (raw === undefined) return undefined;
  const v = raw.trim();
  if (cpLen(v) > max) throw new InputError(`${label} 最多 ${max} 字，当前 ${cpLen(v)} 字`);
  return v;
}

const drop = <T extends Record<string, unknown>>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

export interface Filters {
  keyword?: string;
  category?: string;
  level?: string;
  source?: string;
  status?: string;
}

export function buildFilters(o: Filters): Record<string, string> {
  return drop({
    keyword: o.keyword?.trim() || undefined,
    category: o.category ? oneOf(o.category, CATEGORIES, '--category') : undefined,
    level: o.level ? oneOf(o.level, LEVELS, '--level') : undefined,
    source: o.source ? oneOf(o.source, SOURCES, '--source') : undefined,
    status: o.status ? oneOf(o.status, STATUSES, '--status') : undefined,
  });
}

export interface HabitFields {
  title?: string;
  content?: string;
  category?: string;
  level?: string;
}

/** 四项都校验；缺项取 base（edit / confirm 时为当前值）。 */
export function buildHabitBody(o: HabitFields, base: HabitFields = {}): Record<string, string> {
  const category = o.category ?? base.category;
  if (!category) throw new InputError('--category 必填');
  const level = o.level ?? base.level;
  return {
    title: text(o.title ?? base.title, 50, '--title'),
    content: text(o.content ?? base.content, 500, '--content'),
    category: oneOf(category, CATEGORIES, '--category'),
    ...(level ? { level: oneOf(level, LEVELS, '--level') } : {}),
  };
}

/** 先校验给出的字段（不发请求前就能拦下的错误），再由调用方取当前值合并。 */
export function precheckHabitEdits(o: HabitFields): void {
  buildHabitBody(o, { title: 'x', content: 'x', category: 'OTHER' });
}

export const hasHabitEdits = (o: HabitFields) => [o.title, o.content, o.category, o.level].some((v) => v !== undefined);

export function parseVersion(raw: string | undefined): number | undefined {
  return raw === undefined ? undefined : parseIntInRange(raw, '--version', 1, 2_000_000_000);
}

export function parseDays(raw: string | undefined): number {
  return raw === undefined ? 30 : parseIntInRange(raw, '--days', 1, 90);
}

export function parseSources(raw: string | undefined, kind: 'extract' | 'generate'): string[] | undefined {
  if (raw === undefined) return undefined;
  const allowed = kind === 'extract' ? EXTRACT_SOURCES : GENERATE_SOURCES;
  const list = Array.from(new Set(raw.split(',').map((s) => oneOf(s, allowed, '--sources'))));
  return list;
}

export function parseScene(raw: string, label = '--scene'): string {
  const key = raw.trim();
  const scene = SCENES[key.toLowerCase()] ?? Object.values(SCENES).find((v) => v === key.toUpperCase());
  if (!scene) throw new InputError(`${label} 取值无效: ${raw}（可选: ${Object.keys(SCENES).join(' | ')}）`);
  return scene;
}

export function parseMode(raw: string | undefined): 'REPLACE' | 'SAVE_AS_NEW' | undefined {
  if (raw === undefined) return undefined;
  const mode = requireOneOf(raw.trim().toLowerCase(), MODES, '--mode');
  return mode === 'replace' ? 'REPLACE' : 'SAVE_AS_NEW';
}

export function parseSuggestions(raw: string): number[] {
  const nos = Array.from(new Set(raw.split(',').map((p) => parseId(p, '--suggestions 的每一项'))));
  if (nos.length === 0) throw new InputError('--suggestions 不能为空（逗号分隔的建议编号，如 1,3）');
  return nos;
}

// ── 工作流 ──

export interface StepInput {
  id?: number;
  title: string;
  description: string;
  habitIds: number[];
}

export interface WorkflowFile {
  name?: string;
  description?: string;
  scene?: string;
  steps?: StepInput[];
}

function toStep(raw: unknown, n: number): StepInput {
  if (typeof raw === 'string') return { title: text(raw, 50, `第 ${n} 步标题`), description: '', habitIds: [] };
  const s = raw as Record<string, unknown> | null;
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw new InputError(`第 ${n} 步必须是对象或标题字符串`);
  const ids = s.habitIds === undefined ? [] : s.habitIds;
  if (!Array.isArray(ids)) throw new InputError(`第 ${n} 步 habitIds 必须是数组`);
  const habitIds = Array.from(new Set(ids.map((i) => parseId(String(i), `第 ${n} 步 habitIds 的每一项`))));
  if (habitIds.length > 5) throw new InputError(`第 ${n} 步最多关联 5 条习惯，当前 ${habitIds.length} 条`);
  return {
    ...(s.id === undefined ? {} : { id: parseId(String(s.id), `第 ${n} 步 id`) }),
    title: text(s.title === undefined ? undefined : String(s.title), 50, `第 ${n} 步标题`),
    description: optText(s.description === undefined ? undefined : String(s.description), 300, `第 ${n} 步说明`) ?? '',
    habitIds,
  };
}

/** 数组顺序即步骤顺序，1..20 步。 */
export function toSteps(raw: unknown): StepInput[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 20) throw new InputError('工作流需要 1～20 个步骤');
  return raw.map((s, i) => toStep(s, i + 1));
}

/** 读 JSON / YAML（按扩展名 .yml / .yaml 判断，其余按 JSON）：步骤数组，或 { name, description, scene, steps }。 */
export function readWorkflowFile(file: string): WorkflowFile {
  let parsed: unknown;
  try {
    const content = readFileSync(file, 'utf8');
    parsed = /\.ya?ml$/i.test(file) ? parseYaml(content) : JSON.parse(content);
  } catch (e) {
    throw new InputError(`无法读取 ${file}：${e instanceof Error ? e.message : String(e)}`);
  }
  const obj = Array.isArray(parsed) ? { steps: parsed } : (parsed as Record<string, unknown> | null);
  if (!obj || typeof obj !== 'object') throw new InputError(`${file} 须是步骤数组，或含 steps 的对象`);
  return {
    name: obj.name === undefined ? undefined : String(obj.name),
    description: obj.description === undefined ? undefined : String(obj.description),
    scene: obj.scene === undefined ? undefined : String(obj.scene),
    steps: obj.steps === undefined ? undefined : toSteps(obj.steps),
  };
}

export interface WorkflowOpts {
  name?: string;
  description?: string;
  scene?: string;
  step?: string[];
  fromFile?: string;
}

/** 命令行 / 文件里显式给出的内容（flag 优先于文件）；steps 为 undefined 表示未给。 */
export function workflowOverrides(o: WorkflowOpts): WorkflowFile {
  if (o.fromFile && o.step?.length) throw new InputError('--step 与 --from-file 不能同时使用');
  const file = o.fromFile ? readWorkflowFile(o.fromFile) : {};
  const scene = o.scene ?? file.scene;
  return {
    name: o.name ?? file.name,
    description: o.description ?? file.description,
    scene: scene === undefined ? undefined : parseScene(scene),
    steps: o.step?.length ? toSteps(o.step) : file.steps,
  };
}

/** 与当前内容合并成整体保存的请求体（add 时 base 为空，缺名称 / 场景 / 步骤会被拒绝）。 */
export function buildWorkflowBody(over: WorkflowFile, base: Partial<WorkflowFile> = {}): Required<WorkflowFile> {
  if (!(over.scene ?? base.scene)) throw new InputError('--scene 必填（daily | task）');
  return {
    name: text(over.name ?? base.name, 50, '--name'),
    description: optText(over.description ?? base.description, 200, '--description') ?? '',
    scene: (over.scene ?? base.scene) as string,
    steps: toSteps(over.steps ?? base.steps),
  };
}

export const hasWorkflowEdits = (o: WorkflowFile) => Object.values(o).some((v) => v !== undefined);

// ── 确认 ──

/** --yes 直接通过；交互终端问 y/N；非交互且没有 --yes 时拒绝（不静默删除）。 */
export async function confirmOrThrow(yes: boolean | undefined, question: string): Promise<boolean> {
  if (yes) return true;
  if (!process.stdin.isTTY) throw new InputError(`${question}。非交互环境请加 --yes 确认`);
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer: string = await new Promise((resolve) => rl.question(`${question} [y/N] `, resolve));
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

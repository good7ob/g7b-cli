/**
 * CLI-boundary validation and payload building for `automation` (prd-0135 / backend #989).
 *
 * The backend replaces whole sections on save: a `trigger` section resets the cron / periodic / pool fields, a
 * `target` section needs `projectId` again, a `budget` section writes both token caps (absent = unlimited) and a
 * `billing` section rewrites `confirmEmployeeId`. So `update` reads the current definition and sends every
 * touched section complete (current values + the flags), never a half section.
 */

import {
  ErrorCodeMap,
  InputError,
  checkMaxLength,
  parseId,
  parseIntInRange,
  requireOneOf,
  requireText,
} from '../../utils/cliHelpers';

export const STATUSES = ['draft', 'enabled', 'paused', 'awaiting_approval', 'disabled'] as const;
export const TRIGGERS = ['cron', 'periodic', 'task-pool', 'manual'] as const;
export const EVERY = ['daily', 'weekly', 'monthly'] as const;
export const BILLING = ['org-pool', 'byok'] as const;
export const SOURCES = ['automation', 'manual'] as const;
export const MAX_PAGE_SIZE = 100;

type TriggerCode = 'CRON' | 'PERIODIC' | 'TASK_POOL' | 'MANUAL' | 'EVENT';
const TRIGGER_CODE: Record<string, TriggerCode> = {
  cron: 'CRON', periodic: 'PERIODIC', 'task-pool': 'TASK_POOL', task_pool: 'TASK_POOL', manual: 'MANUAL', event: 'EVENT',
};

export const EVENT_PHASE2 = 'EVENT（事件触发）属第二期，CLI 不支持创建或改为事件触发；请用 cron / periodic / task-pool / manual';

// ── Error codes (backend AutomationErrorEnum @ e5532151 + the platform codes these endpoints answer with) ──

/** Codes with "skipped / 409" semantics (design n1 §6): exit code 3 instead of 1. */
export const SKIP_CODES = new Set([2702, 2708, 2709, 2710, 2711]);
export const EXIT_SKIPPED = 3;

export const AUTOMATION_ERROR_CODES: ErrorCodeMap = {
  1000: '缺少必填参数（新建需要名称、触发器与目标项目）',
  1001: '参数不合法',
  1002: '自动化或组织不存在（或不属于该组织）',
  1006: '组织内已有同名自动化，请换一个 --name',
  2000: '无权访问该接口：AI 员工 Key 只开放自动化的只读接口（写操作须用个人 Key），或后端尚未开放自动化接口',
  2004: '无权操作：启用 / 暂停 / 恢复 / 停用 / 手动运行 / 设置仅组织 owner/admin；新建 / 编辑 / 删除在组织未开放「成员可编辑」时也仅 owner/admin；非组织成员不可见',
  2702: '当前状态不允许该操作（草稿 → 启用；已启用 → 暂停 / 停用 / 运行；已暂停 → 恢复 / 停用 / 运行；审批中须先 withdraw-approval；仅草稿或已停用可删除）',
  2703: 'AI 员工 Key 对自动化只有只读权限（list / show / runs / events / plans / settings get），写操作请用个人 Key',
  2704: '计费主体不可用：组织未开通 Token 池，或启用人的组织池成员额度不足单次运行上限（可改 --billing byok 或调低 --budget-tokens）',
  2705: '目标无效：项目不存在、不属于本组织或已归档',
  2706: '触发器不合法（cron 须为五段且两次触发间隔 ≥ 5 分钟；时刻 HH:mm；星期 1-7；每月日 1-28 或 last；时区须为 IANA 名称）',
  2707: '该自动化还有未结束的运行，运行结束后才能删除',
  2708: '已有进行中的运行（同一自动化互斥），等它结束后再运行',
  2709: '预算已用尽（达到当日 Token 上限）',
  2710: '目标岗位当前没有在线且有空槽的 Runner（先让 Runner 上线，见 good7ob agent）',
  2711: '目标项目没有符合筛选条件的待 AI 执行（pending_agent）任务',
  2712: '组织没有具备开发（DEV）岗位的 AI 员工，无法启用',
  2724: '预算不合法（Token 上限须 > 0 且单次 ≤ 当日；步骤超时 5-1440 分钟；运行超时 15-4320 分钟）',
  2726: '目标类型暂不支持（工作流模板第一期不能启用）',
};

/** Keys the backend puts in front of `msg` (`KEY: field: reason`); they disambiguate shared codes (1001 / 1006). */
export const AUTOMATION_ERROR_KEYS: Record<string, string> = {
  EVENT_TRIGGER_PHASE2: '事件触发（EVENT）属第二期：可以存为草稿，但不能启用',
  AUTOMATION_NAME_DUPLICATE: AUTOMATION_ERROR_CODES[1006],
  INVALID_FIELD: '字段不合法',
};

// ── Small parsers ──

export function parseTriggerType(raw: string): Exclude<TriggerCode, 'EVENT'> {
  const code = TRIGGER_CODE[raw.trim().toLowerCase()];
  if (code === 'EVENT') throw new InputError(EVENT_PHASE2);
  if (!code) throw new InputError(`--trigger 取值无效: ${raw}（可选: ${TRIGGERS.join(' | ')}）`);
  return code;
}

/** Five-field cron (minute hour day month weekday); the backend checks the rest (2706). */
export function parseCron(raw: string): string {
  const fields = raw.trim().split(/\s+/).filter(Boolean);
  if (fields.length !== 5) {
    throw new InputError(`--cron 必须是五段 cron（分 时 日 月 周），如 "0 22 * * 1-5"，收到: ${raw}`);
  }
  return fields.join(' ');
}

/** `H:mm` / `HH:mm` -> `HH:mm`. */
export function parseTime(raw: string, label: string): string {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(raw.trim());
  if (!m) throw new InputError(`${label} 必须是 HH:mm（00:00-23:59），收到: ${raw}`);
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

const DAY_NAMES: Record<string, number> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };

/** `1,3` / `mon,wed` (1 = Monday … 7 = Sunday) -> sorted unique numbers. */
export function parseWeekdays(raw: string, label: string): number[] {
  const parts = raw.split(',').map((p) => p.trim().toLowerCase()).filter(Boolean);
  if (!parts.length) throw new InputError(`${label} 不能为空（1=周一 … 7=周日，或 mon,tue…，逗号分隔）`);
  const days = parts.map((p) => {
    const n = DAY_NAMES[p.slice(0, 3)] ?? (/^[1-7]$/.test(p) ? Number(p) : NaN);
    if (Number.isNaN(n) || (DAY_NAMES[p.slice(0, 3)] && !/^[a-z]+$/.test(p))) {
      throw new InputError(`${label} 取值 1（周一）～ 7（周日）或 mon…sun，收到: ${p}`);
    }
    return n;
  });
  return Array.from(new Set(days)).sort((a, b) => a - b);
}

/** Monthly day: 1-28 or `last`. */
export function parseMonthDay(raw: string): number | 'LAST' {
  if (raw.trim().toLowerCase() === 'last') return 'LAST';
  return parseIntInRange(raw, '--day', 1, 28);
}

/** IANA zone, checked with the runtime's tz database (the backend re-checks: 2706). */
export function parseTimeZone(raw: string, label = '--timezone'): string {
  const tz = raw.trim();
  try {
    if (!tz || !/^[A-Za-z_+\-/0-9]+$/.test(tz)) throw new RangeError();
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    throw new InputError(`${label} 必须是 IANA 时区名，如 Asia/Tokyo、Asia/Shanghai，收到: ${raw}`);
  }
  return tz;
}

/** Token cap: positive integer, or `unlimited` (= null, the backend's "不限"). */
export function parseTokens(raw: string, label: string): number | null {
  if (raw.trim().toLowerCase() === 'unlimited') return null;
  return parseIntInRange(raw, label, 1, Number.MAX_SAFE_INTEGER);
}

const csv = (raw: string, label: string): string[] => {
  const items = Array.from(new Set(raw.split(',').map((s) => s.trim()).filter(Boolean)));
  if (!items.length) throw new InputError(`${label} 不能为空（逗号分隔）`);
  return items;
};

// ── Definition sections ──

export interface Periodic { kind: 'DAILY' | 'WEEKLY' | 'MONTHLY'; weekdays?: number[]; monthDay?: number | 'LAST'; time: string }
export interface Window { start: string; end: string; weekdays?: number[] }
export interface Trigger {
  type: string; cronExpr?: string; timeZone?: string; periodic?: Periodic; poolMinIntervalMinutes?: number;
  window?: Window; graceMinutes?: number; skipNotifyThreshold?: number; display?: string; consecutiveSkips?: number;
}
export interface TaskFilter { priorities?: string[]; labels?: string[]; executorEmployeeId?: number }
export interface Target {
  type?: string; projectId?: number; projectName?: string; taskFilter?: TaskFilter | null; maxTasksPerRun?: number;
  workflowTemplateCode?: string; workflowTemplateVersion?: number | null; matchingTaskCount?: number;
}
export interface Budget {
  runTokenBudget?: number | null; dailyTokenBudget?: number | null; stepTimeoutMinutes?: number; runTimeoutMinutes?: number;
  estimatedPricePerMillion?: number | null; estimatedPriceCurrency?: string | null; todayUsedTokens?: number;
}
export interface Billing {
  subject?: string; confirmEmployeeId?: number | null; runApprovalRequired?: boolean; enabledBy?: number;
  enabledByName?: string; enabledAt?: unknown; effectiveRunApproval?: string; runApprovalSource?: string;
}

/** The fields of AutomationVo that update merges into. */
export interface CurrentDefinition { trigger?: Trigger; target?: Target; budget?: Budget; billing?: Billing }

/** Commander options of `create` / `update`. */
export interface DefinitionFlags {
  name?: string; description?: string; project?: string;
  trigger?: string; cron?: string; every?: string; at?: string; weekday?: string; day?: string;
  timezone?: string; poolInterval?: string; window?: string; windowWeekday?: string; grace?: string;
  taskFilter?: string; tags?: string; priority?: string; executor?: string; maxTasks?: string;
  budgetTokens?: string; dailyBudgetTokens?: string; billing?: string;
}

const TRIGGER_FLAGS: (keyof DefinitionFlags)[] = [
  'trigger', 'cron', 'every', 'at', 'weekday', 'day', 'timezone', 'poolInterval', 'window', 'windowWeekday', 'grace',
];
const FILTER_FLAGS: (keyof DefinitionFlags)[] = ['taskFilter', 'tags', 'priority', 'executor'];
const TARGET_FLAGS: (keyof DefinitionFlags)[] = ['project', 'maxTasks', ...FILTER_FLAGS];
const BUDGET_FLAGS: (keyof DefinitionFlags)[] = ['budgetTokens', 'dailyBudgetTokens'];
const given = (o: DefinitionFlags, keys: (keyof DefinitionFlags)[]) => keys.some((k) => o[k] !== undefined);

export const touchesTrigger = (o: DefinitionFlags) => given(o, TRIGGER_FLAGS);

/** PERIODIC: `--every` + `--at`, `--weekday` for weekly, `--day` for monthly; missing parts come from `base`. */
export function buildPeriodic(o: { every?: string; at?: string; weekday?: string; day?: string }, base?: Periodic): Periodic {
  const kind = o.every !== undefined
    ? requireOneOf(o.every.trim().toLowerCase(), EVERY, '--every').toUpperCase() as Periodic['kind']
    : base?.kind;
  if (!kind) throw new InputError('周期触发需要 --every daily|weekly|monthly');
  const sameKind = base?.kind === kind;
  const time = o.at !== undefined ? parseTime(o.at, '--at') : base?.time;
  if (!time) throw new InputError('周期触发需要 --at HH:mm');
  const out: Periodic = { kind, time };
  if (kind === 'WEEKLY') {
    const weekdays = o.weekday !== undefined ? parseWeekdays(o.weekday, '--weekday') : sameKind ? base?.weekdays : undefined;
    if (!weekdays?.length) throw new InputError('--every weekly 需要 --weekday（如 1,3 或 mon,wed）');
    out.weekdays = weekdays;
  } else if (o.weekday !== undefined) {
    throw new InputError('--weekday 只用于 --every weekly');
  }
  if (kind === 'MONTHLY') {
    const monthDay = o.day !== undefined ? parseMonthDay(o.day) : sameKind ? base?.monthDay : undefined;
    if (monthDay === undefined) throw new InputError('--every monthly 需要 --day（1-28 或 last）');
    out.monthDay = monthDay;
  } else if (o.day !== undefined) {
    throw new InputError('--day 只用于 --every monthly');
  }
  return out;
}

/** `22:00-06:00` (end before start = crosses midnight); `none` clears it. */
export function parseWindow(raw: string): Pick<Window, 'start' | 'end'> | null {
  if (raw.trim().toLowerCase() === 'none') return null;
  const parts = raw.split('-');
  if (parts.length !== 2) throw new InputError(`--window 必须是 HH:mm-HH:mm（如 22:00-06:00），或 none 取消，收到: ${raw}`);
  const start = parseTime(parts[0], '--window 起始');
  const end = parseTime(parts[1], '--window 结束');
  if (start === end) throw new InputError('--window 起止时刻不能相同');
  return { start, end };
}

/**
 * Trigger section. `base` is the current trigger on update (whose type is kept unless --trigger changes it);
 * `keepTimeZone` is the zone to carry over when --timezone is absent (undefined = follow the organisation).
 */
export function buildTrigger(o: DefinitionFlags, base?: Trigger, keepTimeZone?: string): Trigger {
  const type = o.trigger !== undefined ? parseTriggerType(o.trigger) : (base?.type as TriggerCode | undefined);
  if (!type) throw new InputError(`缺少 --trigger（${TRIGGERS.join(' | ')}）`);
  if (type === 'EVENT') throw new InputError(EVENT_PHASE2);
  const sameType = base?.type === type;

  const misplaced = (flags: (keyof DefinitionFlags)[], owner: string) => {
    const bad = flags.filter((k) => o[k] !== undefined);
    if (bad.length) {
      const names = bad.map((k) => '--' + k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()));
      throw new InputError(`${names.join('、')} 只用于 ${owner}（当前触发器 ${type}）`);
    }
  };
  if (type !== 'CRON') misplaced(['cron'], '--trigger cron');
  if (type !== 'PERIODIC') misplaced(['every', 'at', 'weekday', 'day'], '--trigger periodic');
  if (type !== 'TASK_POOL') misplaced(['poolInterval'], '--trigger task-pool');

  const out: Trigger = { type };
  if (type === 'CRON') {
    const cron = o.cron !== undefined ? parseCron(o.cron) : sameType ? base?.cronExpr : undefined;
    if (!cron) throw new InputError('--trigger cron 需要 --cron "<分 时 日 月 周>"，如 --cron "0 22 * * 1-5"');
    out.cronExpr = cron;
  }
  if (type === 'PERIODIC') out.periodic = buildPeriodic(o, sameType ? base?.periodic : undefined);
  if (type === 'TASK_POOL') {
    const interval = o.poolInterval !== undefined ? parseIntInRange(o.poolInterval, '--pool-interval', 5, 1440)
      : sameType ? base?.poolMinIntervalMinutes : undefined;
    if (interval !== undefined) out.poolMinIntervalMinutes = interval;
  }

  const tz = o.timezone !== undefined ? parseTimeZone(o.timezone) : keepTimeZone;
  if (tz) out.timeZone = tz;

  const window = o.window !== undefined ? parseWindow(o.window) : base?.window ? { start: base.window.start, end: base.window.end } : null;
  if (window) {
    const weekdays = o.windowWeekday !== undefined ? parseWeekdays(o.windowWeekday, '--window-weekday')
      : o.window === undefined ? base?.window?.weekdays : undefined;
    out.window = weekdays?.length ? { ...window, weekdays } : window;
  } else if (o.windowWeekday !== undefined) {
    throw new InputError('--window-weekday 需要与 --window HH:mm-HH:mm 一起使用');
  }

  const grace = o.grace !== undefined ? parseIntInRange(o.grace, '--grace', 1, 60) : base?.graceMinutes;
  if (grace !== undefined) out.graceMinutes = grace;
  if (base?.skipNotifyThreshold !== undefined) out.skipNotifyThreshold = base.skipNotifyThreshold;
  return out;
}

const FILTER_KEYS = ['priorities', 'labels', 'executorEmployeeId', 'functionPointIds', 'subModuleIds'];

/** `--task-filter '<json>'`, or `--tags` / `--priority` / `--executor` on top of `base`. */
export function buildTaskFilter(o: DefinitionFlags, base?: TaskFilter | null): TaskFilter | null | undefined {
  const flags = given(o, ['tags', 'priority', 'executor']);
  if (o.taskFilter !== undefined) {
    if (flags) throw new InputError('--task-filter 与 --tags / --priority / --executor 不能同时使用');
    if (o.taskFilter.trim().toLowerCase() === 'none') return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(o.taskFilter);
    } catch {
      throw new InputError(`--task-filter 必须是 JSON 对象，如 '{"labels":["auto"],"priorities":["high"]}'，收到: ${o.taskFilter}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new InputError('--task-filter 必须是 JSON 对象');
    const unknown = Object.keys(parsed).filter((k) => !FILTER_KEYS.includes(k));
    if (unknown.length) throw new InputError(`--task-filter 含未知字段: ${unknown.join(', ')}（可用: ${FILTER_KEYS.join(', ')}）`);
    return parsed as TaskFilter;
  }
  if (!flags) return base;
  const out: TaskFilter = { ...(base ?? {}) };
  if (o.tags !== undefined) out.labels = csv(o.tags, '--tags');
  if (o.priority !== undefined) out.priorities = csv(o.priority, '--priority').map((p) => p.toLowerCase());
  if (o.executor !== undefined) out.executorEmployeeId = parseId(o.executor, '--executor');
  return out;
}

export function buildTarget(o: DefinitionFlags, base?: Target): Target {
  const projectId = o.project !== undefined ? parseId(o.project, '--project') : base?.projectId;
  if (!projectId) throw new InputError('缺少 --project <项目 ID>（自动化从该项目领取待 AI 执行的任务）');
  const out: Target = { type: base?.type ?? 'TASK_FILTER', projectId };
  const filter = buildTaskFilter(o, base?.taskFilter);
  if (filter) out.taskFilter = filter;
  const max = o.maxTasks !== undefined ? parseIntInRange(o.maxTasks, '--max-tasks', 1, 20) : base?.maxTasksPerRun;
  if (max !== undefined) out.maxTasksPerRun = max;
  if (base?.workflowTemplateCode) out.workflowTemplateCode = base.workflowTemplateCode;
  if (base?.workflowTemplateVersion != null) out.workflowTemplateVersion = base.workflowTemplateVersion;
  return out;
}

/** Both caps are always sent: the backend writes absent ones as "unlimited". */
export function buildBudget(o: DefinitionFlags, base?: Budget): Budget {
  const run = o.budgetTokens !== undefined ? parseTokens(o.budgetTokens, '--budget-tokens') : base?.runTokenBudget ?? null;
  const daily = o.dailyBudgetTokens !== undefined ? parseTokens(o.dailyBudgetTokens, '--daily-budget-tokens') : base?.dailyTokenBudget ?? null;
  if (run !== null && daily !== null && run > daily) {
    throw new InputError(`单次 Token 上限 ${run} 不能大于当日上限 ${daily}（--budget-tokens ≤ --daily-budget-tokens）`);
  }
  const out: Budget = { runTokenBudget: run, dailyTokenBudget: daily };
  if (base) {
    for (const k of ['stepTimeoutMinutes', 'runTimeoutMinutes', 'estimatedPricePerMillion', 'estimatedPriceCurrency'] as const) {
      if (base[k] !== undefined && base[k] !== null) (out as Record<string, unknown>)[k] = base[k];
    }
  }
  return out;
}

export function buildBilling(raw: string, base?: Billing): Billing {
  const subject = requireOneOf(raw.trim().toLowerCase(), BILLING, '--billing') === 'byok' ? 'BYOK' : 'ORG_POOL';
  const out: Billing = { subject };
  if (base?.confirmEmployeeId != null) out.confirmEmployeeId = base.confirmEmployeeId;
  if (base?.runApprovalRequired !== undefined) out.runApprovalRequired = base.runApprovalRequired;
  return out;
}

export interface SaveBody {
  name?: string; description?: string; trigger?: Trigger; target?: Target; budget?: Budget; billing?: Billing;
}

/** `POST /automations`: name, project and trigger are required; optional sections only when flagged. */
export function buildCreateBody(o: DefinitionFlags): SaveBody {
  const body: SaveBody = { name: requireText(o.name, 100, '--name').trim() };
  if (o.description !== undefined) body.description = requireText(o.description, 2000, '--description');
  if (o.trigger === undefined) throw new InputError(`缺少 --trigger（${TRIGGERS.join(' | ')}）`);
  body.trigger = buildTrigger(o);
  body.target = buildTarget(o);
  if (given(o, BUDGET_FLAGS)) body.budget = buildBudget(o);
  if (o.billing !== undefined) body.billing = buildBilling(o.billing);
  return body;
}

/**
 * `PUT /automations/{id}`: only touched sections, each complete. `orgTimeZone` decides whether the current trigger
 * zone was explicit (kept) or inherited from the organisation (left empty so it keeps following the org).
 */
export function buildUpdateBody(o: DefinitionFlags, current: CurrentDefinition, orgTimeZone?: string): SaveBody {
  const body: SaveBody = {};
  if (o.name !== undefined) body.name = requireText(o.name, 100, '--name').trim();
  if (o.description !== undefined) body.description = checkMaxLength(o.description, 2000, '--description'); // "" clears it
  if (touchesTrigger(o)) {
    const zone = current.trigger?.timeZone;
    body.trigger = buildTrigger(o, current.trigger, zone && zone !== orgTimeZone ? zone : undefined);
  }
  if (given(o, TARGET_FLAGS)) body.target = buildTarget(o, current.target);
  if (given(o, BUDGET_FLAGS)) body.budget = buildBudget(o, current.budget);
  if (o.billing !== undefined) body.billing = buildBilling(o.billing, current.billing);
  if (!Object.keys(body).length) throw new InputError('没有要修改的内容：至少指定一个字段（如 --name、--cron、--max-tasks、--budget-tokens）');
  return body;
}

// ── Other requests ──

export function buildPreviewBody(o: {
  cron?: string; every?: string; at?: string; weekday?: string; day?: string; timezone?: string;
  window?: string; windowWeekday?: string; count?: string;
}): Record<string, unknown> {
  if ((o.cron === undefined) === (o.every === undefined)) {
    throw new InputError('指定 --cron "<表达式>" 或 --every daily|weekly|monthly 之一（任务池 / 手动触发没有固定时刻）');
  }
  const body: Record<string, unknown> = o.cron !== undefined
    ? { triggerType: 'CRON', cronExpr: parseCron(o.cron) }
    : { triggerType: 'PERIODIC', periodic: buildPeriodic(o) };
  if (o.cron !== undefined && (o.at ?? o.weekday ?? o.day) !== undefined) {
    throw new InputError('--at / --weekday / --day 只用于 --every');
  }
  if (o.timezone !== undefined) body.timeZone = parseTimeZone(o.timezone);
  if (o.window !== undefined) {
    const w = parseWindow(o.window);
    if (w) body.window = o.windowWeekday !== undefined ? { ...w, weekdays: parseWeekdays(o.windowWeekday, '--window-weekday') } : w;
  } else if (o.windowWeekday !== undefined) {
    throw new InputError('--window-weekday 需要与 --window 一起使用');
  }
  body.count = parseIntInRange(o.count ?? '5', '--count', 1, 20);
  return body;
}

export function pageParams(o: { page?: string; pageSize?: string }): { page: number; pageSize: number } {
  return {
    page: parseIntInRange(o.page ?? '1', '--page', 1, 1_000_000),
    pageSize: parseIntInRange(o.pageSize ?? '20', '--page-size', 1, MAX_PAGE_SIZE),
  };
}

export function buildListParams(o: {
  status?: string; project?: string; trigger?: string; keyword?: string; page?: string; pageSize?: string;
}): Record<string, string | number> {
  const params: Record<string, string | number> = { ...pageParams(o) };
  if (o.status !== undefined) params.status = requireOneOf(o.status.trim().toLowerCase(), STATUSES, '--status');
  if (o.project !== undefined) params.projectId = parseId(o.project, '--project');
  if (o.trigger !== undefined) {
    // listing EVENT drafts is allowed (they can exist), only creating / enabling them is phase 2
    const t = o.trigger.trim().toLowerCase();
    params.triggerType = t === 'event' ? 'EVENT' : parseTriggerType(t);
  }
  if (o.keyword !== undefined) params.keyword = requireText(o.keyword, 100, '--keyword');
  return params;
}

export function buildPlansParams(o: {
  source?: string; status?: string; project?: string; trigger?: string; keyword?: string; page?: string; pageSize?: string;
}): Record<string, string | number> {
  const { status, ...rest } = o;
  const params = buildListParams(rest);
  if (o.source !== undefined) {
    const s = o.source.trim().toLowerCase();
    // 'manual' = hand-made project execution plans (backend source EXECUTION_PLAN)
    params.source = s === 'execution-plan' ? 'EXECUTION_PLAN'
      : requireOneOf(s, SOURCES, '--source') === 'automation' ? 'AUTOMATION' : 'EXECUTION_PLAN';
  }
  // status filters definition rows by definition status and plan rows by plan status, so it is passed through
  if (status !== undefined) params.status = requireText(status, 40, '--status').trim().toLowerCase();
  return params;
}

export function buildRunsParams(o: { status?: string; page?: string; pageSize?: string }): Record<string, string | number> {
  const params: Record<string, string | number> = { ...pageParams(o) };
  if (o.status !== undefined) params.status = requireText(o.status, 40, '--status').trim().toLowerCase();
  return params;
}

/** `{reason}` for enable / pause / resume / disable, or no body. */
export function actionBody(reason?: string): { reason: string } | undefined {
  return reason === undefined ? undefined : { reason: requireText(reason, 500, '--reason') };
}

export interface SettingsFlags {
  timezone?: string; requireEnableApproval?: boolean; requireRunApproval?: boolean;
  runApprovalTimeout?: string; memberCanEdit?: boolean;
}

export function buildSettingsBody(o: SettingsFlags): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (o.timezone !== undefined) body.timeZone = parseTimeZone(o.timezone);
  if (o.requireEnableApproval !== undefined) body.enableRequiresApproval = o.requireEnableApproval;
  if (o.requireRunApproval !== undefined) body.runApprovalRequired = o.requireRunApproval;
  if (o.runApprovalTimeout !== undefined) body.runApprovalTimeoutHours = parseIntInRange(o.runApprovalTimeout, '--run-approval-timeout', 1, 168);
  if (o.memberCanEdit !== undefined) body.memberCanEdit = o.memberCanEdit;
  if (!Object.keys(body).length) {
    throw new InputError('没有要修改的设置：指定 --timezone、--[no-]require-enable-approval、--[no-]require-run-approval、--run-approval-timeout 或 --[no-]member-can-edit');
  }
  return body;
}

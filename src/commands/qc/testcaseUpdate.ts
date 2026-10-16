import { parseStep, TestStepInput } from './testcaseFiles';

/**
 * `qc testcase update` helpers. Backend PUT /qc/test/cases/{id} replaces the whole case,
 * so the CLI reads the current case, applies the requested changes and writes it back.
 */

export interface UpdateOptions {
  title?: string;
  precondition?: string;
  suite?: string;
  type?: string;
  priority?: string;
  mode?: string;
  status?: string;
  step?: string[];
  tags?: string;
  addTag?: string[];
  removeTag?: string[];
  scriptPath?: string;
  scriptScenario?: string;
  clearScript?: boolean;
}

/** Fields that only make sense for a single case (unique per case, or free text). */
const SINGLE_ONLY: (keyof UpdateOptions)[] = ['title', 'step', 'scriptPath', 'scriptScenario', 'clearScript'];

const CHANGE_KEYS: (keyof UpdateOptions)[] = [
  'title', 'precondition', 'suite', 'type', 'priority', 'mode', 'status', 'step',
  'tags', 'addTag', 'removeTag', 'scriptPath', 'scriptScenario', 'clearScript',
];

const has = (v: unknown): boolean => (Array.isArray(v) ? v.length > 0 : v !== undefined && v !== false);

export function hasChanges(o: UpdateOptions): boolean {
  return CHANGE_KEYS.some((k) => has(o[k]));
}

/** Throws when the option combination cannot be applied to `idCount` cases. */
export function validateUpdate(o: UpdateOptions, idCount: number): void {
  if (!hasChanges(o)) throw new Error('至少指定一个要修改的字段（如 --priority、--add-tag、--mode）');
  if (idCount > 1) {
    const bad = SINGLE_ONLY.filter((k) => has(o[k]));
    if (bad.length) throw new Error(`一次修改多条用例时不能使用：${bad.map((k) => `--${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}`).join('、')}`);
  }
  if (o.clearScript && (o.scriptPath || o.scriptScenario)) throw new Error('--clear-script 不能与 --script-path / --script-scenario 同用');
  if (o.tags && (has(o.addTag) || has(o.removeTag))) throw new Error('--tags（整体替换）不能与 --add-tag / --remove-tag 同用');
}

const splitCsv = (s: string): string[] => s.split(',').map((x) => x.trim()).filter(Boolean);
const dedupe = (a: string[]): string[] => Array.from(new Set(a));

export interface UpdateBody {
  productId: number;
  suiteId: number | null;
  subModuleId: number | null;
  title: string;
  precondition: string | null;
  steps: TestStepInput[];
  caseType: string;
  priority: string;
  execMode: string;
  status: string;
  tags: string[];
  scriptPath: string | null;
  scriptScenario: string | null;
}

/** Merge requested changes into the current case (as returned by GET /qc/test/cases/{id}). */
export function buildUpdateBody(current: any, o: UpdateOptions): UpdateBody {
  let tags: string[] = Array.isArray(current.tags) ? [...current.tags] : [];
  if (o.tags !== undefined) tags = splitCsv(o.tags);
  if (has(o.addTag)) tags = tags.concat(o.addTag!.flatMap(splitCsv));
  if (has(o.removeTag)) {
    const drop = new Set(o.removeTag!.flatMap(splitCsv));
    tags = tags.filter((t) => !drop.has(t));
  }

  let scriptPath: string | null = current.scriptPath ?? null;
  let scriptScenario: string | null = current.scriptScenario ?? null;
  const execMode: string = o.mode ?? current.execMode;
  if (o.clearScript) { scriptPath = null; scriptScenario = null; }
  if (o.scriptPath !== undefined) scriptPath = o.scriptPath;
  if (o.scriptScenario !== undefined) scriptScenario = o.scriptScenario;
  if (execMode === 'Automated' && (!scriptPath || !scriptScenario)) {
    throw new Error(`${current.caseNo ?? current.id}: 自动化用例须同时有脚本路径与场景名（--script-path / --script-scenario）`);
  }

  return {
    productId: current.productId,
    suiteId: o.suite !== undefined ? Number(o.suite) : current.suiteId ?? null,
    subModuleId: current.subModuleId ?? null,
    title: o.title ?? current.title,
    precondition: o.precondition !== undefined ? o.precondition : current.precondition ?? null,
    steps: has(o.step) ? o.step!.map(parseStep) : (current.steps ?? []),
    caseType: o.type ?? current.caseType,
    priority: o.priority ?? current.priority,
    execMode,
    status: o.status ?? current.status,
    tags: dedupe(tags),
    scriptPath,
    scriptScenario,
  };
}

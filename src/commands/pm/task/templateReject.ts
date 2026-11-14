/**
 * Template enforcement on `pm task create` (prd-0091 FP-24, g7b #3292): the `--template` / `--no-template` request
 * fields, the readable form of the backend's 1001 "已强制" rejection, and the recommend-mode `warnings`.
 *
 * The backend message is `<层级>已强制使用模板，内容不符：<项>；<项>` or `…，不能选「不套模板」` / `…，不能更换模板`.
 * The scope / action words are deliberately not listed here: the answer points at 任务命名规范.
 */
import { InputError, parseId } from '../../../utils/cliHelpers';

export interface TemplateFlags {
  /** `--template <id>` gives the id text; commander's `--no-template` leaves `false` */
  template?: string | false;
}

/** Which of the two flags appeared on the command line (commander cannot tell `--template 9 --no-template` apart). */
export interface TemplateSeen {
  template: boolean;
  noTemplate: boolean;
}

export function templateFields(o: TemplateFlags, seen?: TemplateSeen): Record<string, unknown> {
  if (seen?.template && seen.noTemplate) throw new InputError('--template 与 --no-template 不能同时使用');
  if (o.template === false) return { noTemplate: true };
  if (o.template !== undefined) return { templateId: parseId(o.template, '--template') };
  return {};
}

const FORCED = /^(组织|项目|产品)已强制使用模板，(.*)$/s;
const ITEMS_PREFIX = '内容不符：';
const RULE_SEE = '见任务命名规范（范围词、动作词以它为准）';

/** How to fix one mismatch item, or undefined when the item is not a known kind. */
function fixFor(item: string): string | undefined {
  const max = /超过 (\d+) 字/.exec(item);
  if (max) return `缩短到 ${max[1]} 字内`;
  if (/含(接口路径|文件路径|文件名|类名|字段名)/.test(item)) return '把这些放进描述，不放标题';
  if (/格式|范围词|动作词|缺少对象|缺少 \[范围\]|不能为空/.test(item)) return `标题用「[范围] 动作 + 对象」，${RULE_SEE}`;
  return undefined;
}

/** The multi-line text for a backend 1001 that says "已强制"; undefined for any other error (keep the old output). */
export function describeTemplateReject(error: unknown): string | undefined {
  const e = error as { code?: unknown; message?: string } | null;
  if (e?.code !== 1001) return undefined;
  const m = FORCED.exec(e.message ?? '');
  if (!m) return undefined;
  const head = `创建被拒：${m[1]}已强制使用模板`;
  const tail = m[2];
  if (tail.startsWith(ITEMS_PREFIX)) {
    const lines = tail.slice(ITEMS_PREFIX.length).split('；').filter(Boolean).map((item) => {
      const fix = fixFor(item);
      return `  · ${item}${fix ? `\n    改法：${fix}` : ''}`;
    });
    return [head, '内容不符：', ...lines].join('\n');
  }
  const hint = tail.includes('不套模板')
    ? '去掉 --no-template，按生效模板创建'
    : tail.includes('更换模板')
      ? '去掉 --template，沿用生效模板'
      : undefined;
  return [head, `  · ${tail}`, ...(hint ? [`    改法：${hint}`] : [])].join('\n');
}

/** Recommend-mode hits answer the created task with `warnings: [{field, message}]`; one 提示 line each. */
export function printWarnings(task: { warnings?: Array<{ field?: string; message?: string }> | null } | null | undefined): void {
  (task?.warnings ?? []).forEach((w) => console.log(`提示：${w.message ?? w.field ?? ''}`));
}

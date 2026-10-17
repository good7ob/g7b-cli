import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { InputError, parseId, requireOneOf } from '../../utils/cliHelpers';

/**
 * 评估中心（prd-0119）：选评分模板发起评估；AI 评审项可由平台模型评，也可用 --mode external
 * 由本地 Agent 自己评分后回传。回传的 SCORED 项必须带证据片段（quote 须逐字出现在评估对象原文中），
 * 一项不合格整批拒收；回传分数与平台 AI 的分数同级计分。
 */

const KINDS: Record<string, string> = {
  prd: 'PRD_VERSION',
  'task-plan': 'TASK_PLAN',
  report: 'REPORT',
  package: 'ARTIFACT_PACKAGE',
  testcases: 'TEST_CASE_SET',
  api: 'API_DESIGN',
  db: 'DB_DESIGN',
  arch: 'ARCH_DESIGN',
};
const MODES = ['external', 'platform'] as const;

export function toKind(raw: string): string {
  const kind = KINDS[raw];
  if (!kind) throw new InputError(`对象种类必须是 ${Object.keys(KINDS).join(' | ')}，收到: ${raw}`);
  return kind;
}

interface StartOptions {
  template: string;
  org?: string;
  product?: string;
  project?: string;
  mode?: string;
  model?: string;
  yes?: boolean;
  confirmDuplicate?: boolean;
}

/** 发起请求体。external 不带模型与费用字段；platform 必须 --model 且 --yes 确认对象内容会送往该模型。 */
export function buildStartBody(kind: string, id: string, o: StartOptions): Record<string, unknown> {
  const mode = requireOneOf(o.mode ?? 'external', MODES, '--mode');
  const body: Record<string, unknown> = {
    orgId: o.org ? parseId(o.org, '--org') : undefined,
    productId: o.product ? parseId(o.product, '--product') : undefined,
    projectId: o.project ? parseId(o.project, '--project') : undefined,
    target: { type: 'ARTIFACT', kind: toKind(kind), id: parseId(id, 'id') },
    templateId: parseId(o.template, '--template'),
    judgeMode: mode === 'external' ? 'EXTERNAL' : 'PLATFORM',
    confirmations: { cost: true, dataFlow: mode === 'platform' && !!o.yes, duplicate: !!o.confirmDuplicate },
  };
  if (mode === 'platform') {
    if (!o.model) throw new InputError('--mode platform 需要 --model <模型ID>');
    if (!o.yes) throw new InputError('--mode platform 会把对象内容发给评审模型并产生费用，确认请加 --yes');
    body.judge = { modelId: parseId(o.model, '--model') };
  } else if (o.model) {
    throw new InputError('--mode external 不调用平台模型，不能带 --model');
  }
  return body;
}

/** 读回传文件：数组，或 { items: [...] }。 */
export function readItems(file: string): unknown[] {
  let parsed: any;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new InputError(`无法读取 ${file}：${e instanceof Error ? e.message : String(e)}`);
  }
  const items = Array.isArray(parsed) ? parsed : parsed?.items;
  if (!Array.isArray(items) || items.length === 0) throw new InputError('文件须是非空数组，或 { "items": [...] }');
  return items;
}

function fail(what: string, e: unknown): never {
  console.error(`✗ ${what}:`, e instanceof Error ? e.message : String(e));
  const data = (e as any)?.response?.data?.data;
  if (data?.errors) data.errors.forEach((x: any) => console.error(`  - ${x.itemId}: ${x.problem}`));
  process.exit(1);
}

export function registerEvalCommands(program: Command) {
  const cmd = program
    .command('eval')
    .description('评估中心：选评分模板评估对象；AI 评审项可由本地 Agent 评分后回传（须带证据片段）');

  cmd.command('templates')
    .description('列出可选的评分模板')
    .requiredOption('--kind <kind>', Object.keys(KINDS).join(' | '))
    .option('--org <orgId>', '组织 ID')
    .option('--json', '输出 JSON')
    .action(async (o) => {
      try {
        const page = await apiClient.get('/evaluation/standards', {
          params: { orgId: o.org, targetType: 'ARTIFACT', artifactKind: toKind(o.kind), pageSize: 50 },
        });
        const rows = page?.items ?? page?.records ?? [];
        if (o.json) return console.log(JSON.stringify(rows, null, 2));
        rows.forEach((r: any) => console.log(`#${String(r.templateId ?? r.id).padEnd(6)}${r.name}  ${r.version ?? ''}  ${r.scope ?? ''}`));
      } catch (e) { fail('读取评分模板失败', e); }
    });

  cmd.command('start <kind> <id>')
    .description('发起评估。默认 --mode external：平台不调模型、不收费，由你评分后用 eval submit 回传')
    .requiredOption('--template <id>', '评分模板 ID（eval templates 查）')
    .option('--org <orgId>', '组织 ID')
    .option('--product <id>', '产品 ID')
    .option('--project <id>', '项目 ID')
    .option('--mode <mode>', 'external | platform', 'external')
    .option('--model <id>', 'platform 模式的评审模型 ID')
    .option('--yes', 'platform 模式：确认对象内容送往评审模型并产生费用')
    .option('--confirm-duplicate', '已有相同对象与模板的评估时仍然发起')
    .option('--json', '输出 JSON')
    .action(async (kind, id, o) => {
      try {
        const body = buildStartBody(kind, id, o);
        const res = await apiClient.post('/evaluation/runs', body, { headers: { 'Idempotency-Key': randomUUID() } });
        if (o.json) return console.log(JSON.stringify(res, null, 2));
        const run = res?.run ?? res;
        console.log(`✓ 已发起评估 #${run.id}，状态 ${run.status}`);
        if (body.judgeMode === 'EXTERNAL') console.log(`  下一步：good7ob eval input ${run.id} --out input.json`);
      } catch (e) { fail('发起评估失败', e); }
    });

  cmd.command('input <runId>')
    .description('外部评分：取待评分的 AI 评审项与评估对象原文')
    .option('--out <file>', '写入文件（默认打印到终端）')
    .action(async (runId, o) => {
      try {
        const res = await apiClient.get(`/evaluation/runs/${parseId(runId, 'runId')}/external-input`);
        const text = JSON.stringify(res, null, 2);
        if (o.out) {
          writeFileSync(o.out, text);
          console.log(`✓ 已写入 ${o.out}（${res?.targets?.length ?? 0} 个对象）`);
        } else {
          console.log(text);
        }
      } catch (e) { fail('读取外部评分输入失败', e); }
    });

  cmd.command('submit <runId>')
    .description('外部评分：整批回传成绩。文件为 items 数组；SCORED 项须带 evidence[{quote}]')
    .requiredOption('--file <path>', '成绩 JSON 文件')
    .requiredOption('--scorer <name>', '评分工具 / 模型名，如 claude-opus-5@claude-code')
    .option('--json', '输出 JSON')
    .action(async (runId, o) => {
      try {
        const items = readItems(o.file);
        const res = await apiClient.post(`/evaluation/runs/${parseId(runId, 'runId')}/external-scores`, {
          scorer: String(o.scorer).trim(),
          items,
        });
        if (o.json) return console.log(JSON.stringify(res, null, 2));
        console.log(`✓ 已接收 ${res.accepted} 项；评估状态 ${res.run?.status}/${res.run?.stage}，剩余待回传 ${res.pendingExternalItems} 项`);
      } catch (e) { fail('回传外部评分失败', e); }
    });

  cmd.command('show <runId>')
    .description('评估详情与进度')
    .option('--json', '输出 JSON')
    .action(async (runId, o) => {
      try {
        const res = await apiClient.get(`/evaluation/runs/${parseId(runId, 'runId')}`);
        if (o.json) return console.log(JSON.stringify(res, null, 2));
        const r = res.run;
        console.log(`#${r.id} ${r.target?.name ?? ''}  模板 ${r.template?.name} ${r.template?.version}  ${r.judgeMode}`);
        console.log(`状态 ${r.status}/${r.stage}  进度 ${r.progress?.itemsDone}/${r.progress?.itemsTotal}  待回传 ${res.pendingExternalItems?.length ?? 0} 项`);
      } catch (e) { fail('读取评估失败', e); }
    });
}

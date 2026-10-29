import { Command } from 'commander';
import fs from 'fs';
import apiClient from '../../services/ApiClient';

/**
 * 质量流水线（backend /qc/pipelines、/qc/runs、/qc/gate；设计见 backend/docs/api/api-quality-pipeline-phase1.md）。
 * 本机、CI 和 Hermes 共用同一套上报命令：start → report → attach → finish，平台不托管 Playwright。
 */

const VERDICT_CN: Record<string, string> = { PASS: '通过', CONDITIONAL: '有条件通过', FAIL: '不通过' };
const STAGE_ICON: Record<string, string> = { done: '●', active: '◐', pending: '○' };

function fail(label: string, e: unknown): never {
  console.error(`✗ ${label}:`, e instanceof Error ? e.message : String(e));
  process.exit(1);
}

/** report 文件既可以是结果数组，也可以是 { results: [...] }（Playwright JSON reporter 转换后的产物同理）。 */
export function parseReportFile(raw: string): unknown[] {
  const parsed = JSON.parse(raw);
  const list = Array.isArray(parsed) ? parsed : parsed?.results;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('结果文件必须是非空数组，或带 results 数组的对象');
  }
  for (const item of list) {
    if (!item || typeof item.caseId !== 'number' || typeof item.result !== 'string') {
      throw new Error('每条结果需要数字 caseId 和字符串 result（Passed|Failed|Blocked|Skipped）');
    }
  }
  return list;
}

export function printGate(gate: any) {
  if (!gate) return;
  const waived = gate.waivedAt ? '（已豁免）' : '';
  console.log(`\n质量门禁：${VERDICT_CN[gate.verdict] ?? gate.verdict}${waived}  构建 ${gate.buildRef ?? '-'}`);
  for (const o of gate.ruleOutcomes ?? []) {
    console.log(`  ${o.met ? '✓' : '✗'} [${o.level === 'blocking' ? '阻断' : '警告'}] ${o.message}`);
  }
}

export function registerPipelineCommands(qcCommand: Command) {
  // ── run ──
  const run = qcCommand.command('run').description('测试执行批次 — 开始、上报结果、上传证据、结束（本机 / CI / Hermes 共用）');

  run.command('start')
    .description('开始一个执行批次')
    .requiredOption('--product <id>', '产品 ID')
    .option('--pipeline <id>', '质量流水线 ID')
    .option('--plan <id>', '测试计划 ID（结束时结果会写回计划）')
    .option('--round <type>', 'Initial|Verification|Regression|Full', 'Initial')
    .option('--trigger <type>', 'manual|ci|agent', 'manual')
    .option('--executor <type>', 'HUMAN|CI|AGENT', 'HUMAN')
    .option('--build <ref>', '提交 SHA 或版本号（门禁按它判断最终构建）')
    .option('--env <name>', '测试环境说明')
    .option('--json', '输出 JSON')
    .action(async (o) => {
      try {
        const r = await apiClient.post('/qc/runs', {
          productId: Number(o.product),
          pipelineId: o.pipeline ? Number(o.pipeline) : undefined,
          planId: o.plan ? Number(o.plan) : undefined,
          roundType: o.round,
          triggerType: o.trigger,
          executorType: o.executor,
          buildRef: o.build,
          environment: o.env,
        });
        if (o.json) { console.log(JSON.stringify(r, null, 2)); return; }
        console.log(`✓ 批次已开始: ${r.runNo}  (ID ${r.id})  类型 ${r.roundType}  构建 ${r.buildRef ?? '-'}`);
      } catch (e) { fail('开始批次失败', e); }
    });

  run.command('report <run-id>')
    .description('批量上报结果（同 run + case + attempt 重复上报会覆盖，可重试）')
    .requiredOption('--file <path>', '结果 JSON 文件：[{caseId, attempt?, result, durationMs?, failureMessage?}]')
    .option('--json', '输出 JSON')
    .action(async (runId, o) => {
      try {
        const results = parseReportFile(fs.readFileSync(o.file, 'utf-8'));
        const r = await apiClient.post(`/qc/runs/${runId}/results`, { results });
        if (o.json) { console.log(JSON.stringify(r, null, 2)); return; }
        console.log(`✓ 已上报 ${results.length} 条（新增 ${r.inserted}，覆盖 ${r.updated}）`);
      } catch (e) { fail('上报结果失败', e); }
    });

  run.command('attach <result-id>')
    .description('为一条结果上传证据（截图 / trace / 日志 / 视频）')
    .requiredOption('--kind <kind>', 'screenshot|trace|log|video')
    .requiredOption('--file <path>', '证据文件')
    .action(async (resultId, o) => {
      try {
        if (!fs.existsSync(o.file)) throw new Error(`文件不存在: ${o.file}`);
        const r = await apiClient.uploadFile(`/qc/runs/results/${resultId}/evidence`, o.file, 'file', { kind: o.kind });
        console.log(`✓ 证据已上传: ${(r as any).fileName}`);
      } catch (e) { fail('上传证据失败', e); }
    });

  run.command('finish <run-id>')
    .description('结束批次：结果写回计划，失败自动建 Bug（去重），全量批次自动评估门禁')
    .option('--json', '输出 JSON')
    .action(async (runId, o) => {
      try {
        const r = await apiClient.post(`/qc/runs/${runId}/finish`, {});
        if (o.json) { console.log(JSON.stringify(r, null, 2)); return; }
        const s = r.summary;
        console.log(`✓ 批次 ${r.run.runNo} 已结束：共 ${s.total}  通过 ${s.passed}  失败 ${s.failed}  阻塞 ${s.blocked}  跳过 ${s.skipped}  抖动 ${s.flaky}`);
        if (r.createdBugIds?.length) console.log(`  新建 Bug: ${r.createdBugIds.join(', ')}`);
        if (r.reusedBugIds?.length) console.log(`  已存在的 Bug（追加失败记录）: ${r.reusedBugIds.join(', ')}`);
        if (r.bugSkippedReason) console.log(`  ⚠ ${r.bugSkippedReason}`);
        printGate(r.gate);
      } catch (e) { fail('结束批次失败', e); }
    });

  run.command('get <run-id>')
    .description('批次详情（逐条结果）')
    .option('--json', '输出 JSON')
    .action(async (runId, o) => {
      try {
        const r = await apiClient.get(`/qc/runs/${runId}`);
        if (o.json) { console.log(JSON.stringify(r, null, 2)); return; }
        console.log(`\n${r.run.runNo}  ${r.run.roundType}  ${r.run.status}  构建 ${r.run.buildRef ?? '-'}`);
        for (const x of r.results ?? []) {
          console.log(`  ${String(x.caseNo).padEnd(10)} 第${x.result.attempt}次 ${x.result.result.padEnd(8)} ${(x.caseTitle || '').substring(0, 40)}`);
        }
      } catch (e) { fail('获取批次失败', e); }
    });

  run.command('list <product-id>')
    .description('批次列表')
    .option('--pipeline <id>', '按流水线筛选')
    .option('--json', '输出 JSON')
    .action(async (productId, o) => {
      try {
        const r = await apiClient.post('/qc/runs/list', {
          productId: Number(productId), pipelineId: o.pipeline ? Number(o.pipeline) : undefined, pageNum: 1, pageSize: 50,
        });
        if (o.json) { console.log(JSON.stringify(r, null, 2)); return; }
        for (const x of r.list ?? []) {
          const s = x.summary;
          console.log(`${x.run.runNo.padEnd(8)} ${x.run.roundType.padEnd(13)} ${x.run.status.padEnd(9)} 通过 ${s.passed}/${s.total}  失败 ${s.failed}  构建 ${x.run.buildRef ?? '-'}`);
        }
      } catch (e) { fail('获取批次列表失败', e); }
    });

  // ── pipeline ──
  const pipeline = qcCommand.command('pipeline').description('质量流水线 — 创建、查看阶段、评估门禁、豁免');

  pipeline.command('create')
    .description('为发布或需求创建流水线（同范围已有则返回已有）')
    .requiredOption('--scope <type>', 'RELEASE|REQUIREMENT')
    .requiredOption('--id <id>', 'RELEASE=发布 ID；REQUIREMENT=PRD ID')
    .option('--release <id>', '需求流水线所属的发布')
    .option('--bug-project <id>', '自动建 Bug 落入的项目')
    .option('--name <name>', '名称')
    .option('--json', '输出 JSON')
    .action(async (o) => {
      try {
        const r = await apiClient.post('/qc/pipelines', {
          scopeType: o.scope, scopeId: Number(o.id),
          releaseId: o.release ? Number(o.release) : undefined,
          bugProjectId: o.bugProject ? Number(o.bugProject) : undefined, name: o.name,
        });
        if (o.json) { console.log(JSON.stringify(r, null, 2)); return; }
        console.log(`✓ 流水线 ${r.id}  ${r.name}  缺陷项目 ${r.bugProjectId ?? '未配置'}`);
      } catch (e) { fail('创建流水线失败', e); }
    });

  pipeline.command('get <id>')
    .description('流水线详情：8 个阶段与最新门禁')
    .option('--json', '输出 JSON')
    .action(async (id, o) => {
      try {
        const r = await apiClient.get(`/qc/pipelines/${id}`);
        if (o.json) { console.log(JSON.stringify(r, null, 2)); return; }
        console.log(`\n${r.pipeline.name}  [${r.pipeline.scopeType} ${r.pipeline.scopeRef}]`);
        console.log(`范围：${r.functionPointCount} 功能点 / ${r.rulePointCount} 规则点 / ${r.caseCount} 生效用例  最新构建 ${r.latestBuildRef ?? '-'}`);
        for (const s of r.stages) console.log(`  ${STAGE_ICON[s.status] ?? '?'} ${s.label.padEnd(6)} ${s.detail}`);
        printGate(r.latestGate);
      } catch (e) { fail('获取流水线失败', e); }
    });

  pipeline.command('by-scope')
    .description('按范围查流水线')
    .requiredOption('--scope <type>', 'RELEASE|REQUIREMENT')
    .requiredOption('--id <id>', '范围对象 ID')
    .option('--json', '输出 JSON')
    .action(async (o) => {
      try {
        const r = await apiClient.get('/qc/pipelines/by-scope', { scopeType: o.scope, scopeId: Number(o.id) });
        console.log(o.json ? JSON.stringify(r, null, 2) : `流水线 ${r.id}  ${r.name}  状态 ${r.status}`);
      } catch (e) { fail('查询流水线失败', e); }
    });

  pipeline.command('evaluate <id>')
    .description('评估质量门禁')
    .option('--json', '输出 JSON')
    .action(async (id, o) => {
      try {
        const r = await apiClient.post(`/qc/pipelines/${id}/evaluate`, {});
        if (o.json) { console.log(JSON.stringify(r, null, 2)); return; }
        printGate(r);
      } catch (e) { fail('评估失败', e); }
    });

  pipeline.command('waive <id>')
    .description('豁免未通过的结论（仅组织 owner/admin，AI 员工不可用）')
    .requiredOption('--reason <text>', '豁免理由（必填，会随审批展示）')
    .action(async (id, o) => {
      try {
        const r = await apiClient.post(`/qc/pipelines/${id}/waive`, { reason: o.reason });
        console.log(`✓ 已豁免（结论 ${VERDICT_CN[r.verdict] ?? r.verdict}）`);
      } catch (e) { fail('豁免失败', e); }
    });

  // ── gate ──
  const gate = qcCommand.command('gate').description('质量门禁规则');

  gate.command('rules <product-id>')
    .description('查看门禁规则')
    .option('--json', '输出 JSON')
    .action(async (productId, o) => {
      try {
        const r = await apiClient.get('/qc/gate/rules', { productId: Number(productId) });
        if (o.json) { console.log(JSON.stringify(r, null, 2)); return; }
        for (const x of r) {
          console.log(`${x.enabled ? '■' : '□'} ${x.ruleKey.padEnd(26)} ${x.level.padEnd(9)} ${JSON.stringify(x.params)}  ${x.title}`);
        }
      } catch (e) { fail('获取门禁规则失败', e); }
    });

  gate.command('set <product-id>')
    .description('启用 / 停用 / 调整一条门禁规则（仅组织 owner/admin）')
    .requiredOption('--rule <key>', '规则键，见 gate rules')
    .option('--enable', '启用')
    .option('--disable', '停用')
    .option('--level <level>', 'blocking|warning')
    .option('--min <n>', '阈值（PASS_RATE / RP_COVERAGE）')
    .action(async (productId, o) => {
      try {
        if (o.enable && o.disable) throw new Error('--enable 和 --disable 不能同时使用');
        const params = o.min !== undefined ? { min: Number(o.min) } : undefined;
        await apiClient.put('/qc/gate/rules', {
          productId: Number(productId),
          rules: [{ ruleKey: o.rule, level: o.level, params, enabled: o.enable ? true : o.disable ? false : undefined }],
        });
        console.log(`✓ 规则 ${o.rule} 已更新`);
      } catch (e) { fail('保存门禁规则失败', e); }
    });
}

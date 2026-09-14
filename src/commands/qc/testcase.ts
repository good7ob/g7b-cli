import { Command } from 'commander';
import path from 'path';
import apiClient from '../../services/ApiClient';
import { collectFeatureFiles, ensureSuitePath, parseStep, planBatches, readBatchFile, SuiteRef } from './testcaseFiles';

/**
 * 测试用例库 (prd-0082 FP-1~FP-3, api-0082) — backend TestCaseController, BASE PATH /qc/test.
 */

const STATUS_CN: Record<string, string> = { Draft: '草稿', Active: '生效', Deprecated: '废弃' };
const SOURCE_CN: Record<string, string> = { manual: '手工', rule_point: '由 RP 生成', feature_import: 'Gherkin 导入' };
const RESULT_ICON: Record<string, string> = { created: '＋', updated: '↻', skipped: '✗' };

const collect = (value: string, previous: string[]): string[] => previous.concat([value]);
const csv = (value?: string): string[] | undefined =>
  value ? value.split(',').map((s) => s.trim()).filter(Boolean) : undefined;

function fail(label: string, e: unknown): never {
  console.error(`✗ ${label}:`, e instanceof Error ? e.message : String(e));
  process.exit(1);
}

export function registerTestCaseCommands(qcCommand: Command) {
  const tc = qcCommand
    .command('testcase')
    .alias('tc')
    .description('测试用例库 — 列表、详情、创建、导入 Gherkin、RP 覆盖率、目录');

  // ── list ──────────────────────────────────────────────────────────────

  tc.command('list <product-id>')
    .description('列出产品下的测试用例')
    .option('--suite <id>', '目录 ID（含子目录）')
    .option('--status <status>', 'Draft|Active|Deprecated，逗号分隔')
    .option('--priority <priority>', 'P0|P1|P2|P3，逗号分隔')
    .option('--type <type>', 'Functional|UI|API|Integration|Regression|Smoke|E2E，逗号分隔')
    .option('--mode <mode>', 'Manual|Automated')
    .option('--keyword <keyword>', '标题或编号关键词')
    .option('-p, --page <num>', '页码', '1')
    .option('-l, --limit <num>', '每页条数', '20')
    .option('--json', '输出 JSON')
    .action(async (productId, o) => {
      try {
        const result = await apiClient.post('/qc/test/cases/list', {
          productId: Number(productId),
          suiteId: o.suite ? Number(o.suite) : undefined,
          statuses: csv(o.status),
          priorities: csv(o.priority),
          caseTypes: csv(o.type),
          execMode: o.mode,
          keyword: o.keyword,
          pageNum: Number(o.page),
          pageSize: Number(o.limit),
        });
        if (o.json) { console.log(JSON.stringify(result, null, 2)); return; }
        const cases: any[] = result?.list ?? [];
        if (!cases.length) { console.log('未找到测试用例。'); return; }

        console.log(`\n测试用例 — 产品 ${productId}  (共 ${result.total} 条)`);
        console.log('─'.repeat(110));
        console.log('编号'.padEnd(10) + '标题'.padEnd(40) + '类型'.padEnd(13) + '优先级'.padEnd(7) + '执行'.padEnd(11) + '状态'.padEnd(8) + '更新时间');
        console.log('─'.repeat(110));
        cases.forEach((c) => {
          console.log(
            String(c.caseNo).padEnd(10) +
            (c.title || '').substring(0, 38).padEnd(40) +
            (c.caseType || '').padEnd(13) +
            (c.priority || '').padEnd(7) +
            (c.execMode || '').padEnd(11) +
            (STATUS_CN[c.status] || c.status || '').padEnd(8) +
            (c.updatedAt || '-')
          );
        });
        console.log('─'.repeat(110));
        if (result.total > cases.length) console.log(`（第 ${o.page} 页，共 ${result.total} 条）`);
        console.log();
      } catch (e) {
        fail('获取测试用例列表失败', e);
      }
    });

  // ── get ───────────────────────────────────────────────────────────────

  tc.command('get <id>')
    .description('查看用例详情（步骤 + 关联 RP）')
    .option('--json', '输出 JSON')
    .action(async (id, o) => {
      try {
        const c = await apiClient.get(`/qc/test/cases/${id}`);
        if (o.json) { console.log(JSON.stringify(c, null, 2)); return; }

        console.log('\n── 测试用例 ────────────────────────────────────────');
        console.log(`编号:       ${c.caseNo}   (ID ${c.id}，产品 ${c.productId}，目录 ${c.suiteId ?? '-'})`);
        console.log(`标题:       ${c.title}`);
        console.log(`状态:       ${STATUS_CN[c.status] ?? c.status} (${c.status})   类型: ${c.caseType}   优先级: ${c.priority}`);
        console.log(`执行方式:   ${c.execMode}   来源: ${SOURCE_CN[c.source] ?? c.source}`);
        if (c.scriptPath) console.log(`脚本位置:   ${c.scriptPath}  ›  ${c.scriptScenario}`);
        if (c.tags?.length) console.log(`标签:       ${c.tags.join(', ')}`);
        if (c.precondition) console.log(`前置条件:\n  ${c.precondition.replace(/\n/g, '\n  ')}`);

        console.log('\n── 步骤 ─────────────────────────────────────────────');
        (c.steps ?? []).forEach((s: any, i: number) => {
          console.log(`  ${i + 1}. ${s.action.replace(/\n/g, '\n     ')}`);
          if (s.expected) console.log(`     → ${s.expected.replace(/\n/g, '\n       ')}`);
        });

        const rps: any[] = c.rulePoints ?? [];
        console.log(`\n── 关联 RP (${rps.length}) ───────────────────────────────────`);
        rps.forEach((rp) => console.log(`  ${rp.code}${rp.archived ? ' [已归档]' : ''}  ${rp.statement}`));
        console.log();
      } catch (e) {
        fail('获取用例详情失败', e);
      }
    });

  // ── create ────────────────────────────────────────────────────────────

  tc.command('create')
    .description('创建测试用例')
    .requiredOption('--product-id <id>', '产品 ID')
    .requiredOption('--title <title>', '用例标题')
    .option('--step <操作::预期>', '步骤，可重复；至少一条同时含操作与预期', collect, [])
    .option('--precondition <text>', '前置条件')
    .option('--suite <id>', '目录 ID')
    .option('--type <type>', 'Functional|UI|API|Integration|Regression|Smoke|E2E（默认 Functional）')
    .option('--priority <priority>', 'P0|P1|P2|P3（默认 P2）')
    .option('--mode <mode>', 'Manual|Automated（默认 Manual）')
    .option('--status <status>', 'Draft|Active（默认 Draft）')
    .option('--tag <tag>', '标签，可重复', collect, [])
    .option('--script-path <path>', '自动化脚本文件相对路径（Automated 必填）')
    .option('--script-scenario <name>', '脚本内场景名（Automated 必填）')
    .option('--rp <ids>', '关联 RP ID，逗号分隔')
    .option('--json', '输出 JSON')
    .action(async (o) => {
      try {
        const created = await apiClient.post('/qc/test/cases', {
          productId: Number(o.productId),
          title: o.title,
          steps: o.step.map(parseStep),
          precondition: o.precondition,
          suiteId: o.suite ? Number(o.suite) : undefined,
          caseType: o.type,
          priority: o.priority,
          execMode: o.mode,
          status: o.status,
          tags: o.tag,
          scriptPath: o.scriptPath,
          scriptScenario: o.scriptScenario,
          rulePointIds: csv(o.rp)?.map(Number),
        });
        if (o.json) { console.log(JSON.stringify(created, null, 2)); return; }
        console.log(`✓ 用例已创建  ${created.caseNo}  (ID ${created.id}，状态 ${created.status})`);
      } catch (e) {
        fail('创建用例失败', e);
      }
    });

  // ── import ────────────────────────────────────────────────────────────

  tc.command('import <paths...>')
    .description('导入 Gherkin .feature 文件（可传目录，递归查找）；同路径 + 场景名再次导入会更新而非重复创建')
    .requiredOption('--product-id <id>', '产品 ID')
    .option('--root <dir>', '脚本路径的相对基准目录，一般是仓库根目录', '.')
    .option('--base-path <prefix>', '统一的脚本路径前缀，覆盖按目录计算的结果')
    .option('--dry-run', '只列出将导入的文件与脚本路径，不上传')
    .option('--json', '输出 JSON')
    .action(async (paths: string[], o) => {
      let done = 0;
      const total = { created: 0, updated: 0, skipped: 0, items: [] as any[] };
      try {
        const files = collectFeatureFiles(paths);
        if (!files.length) throw new Error('未找到 .feature 文件');
        const batches = planBatches(files, path.resolve(o.root), o.basePath);

        if (o.dryRun) {
          batches.forEach((b) => b.files.forEach((f) => console.log(`${b.basePath}${path.basename(f)}`)));
          console.log(`\n共 ${files.length} 个文件，将分 ${batches.length} 次请求上传（未上传，--dry-run）`);
          return;
        }

        for (const b of batches) {
          const fields: Record<string, string> = { productId: String(o.productId) };
          if (b.basePath) fields.basePath = b.basePath;
          const r = await apiClient.uploadFiles('/qc/test/cases/import-feature', b.files, 'files', fields);
          total.created += r?.created ?? 0;
          total.updated += r?.updated ?? 0;
          total.skipped += r?.skipped ?? 0;
          total.items.push(...(r?.items ?? []).map((i: any) => ({ ...i, file: `${b.basePath}${i.file}` })));
          done += 1;
        }

        if (o.json) { console.log(JSON.stringify(total, null, 2)); return; }
        total.items.forEach((i) => {
          const where = i.scenario ? `${i.file} › ${i.scenario}` : i.file;
          console.log(`  ${RESULT_ICON[i.result] ?? ' '} ${(i.caseNo || '').padEnd(8)} ${where}${i.reason ? `  (${i.reason})` : ''}`);
        });
        console.log(`\n✓ 导入完成  新建 ${total.created}  更新 ${total.updated}  跳过 ${total.skipped}`);
      } catch (e) {
        if (done > 0) console.error(`已完成 ${done} 批：新建 ${total.created}  更新 ${total.updated}  跳过 ${total.skipped}`);
        fail('导入失败', e);
      }
    });

  // ── create-batch ──────────────────────────────────────────────────────

  tc.command('create-batch <file>')
    .description('按 JSON 文件批量创建用例；suite 写目录路径（"一级/二级"），不存在的目录自动创建')
    .requiredOption('--product-id <id>', '产品 ID')
    .option('--skip <n>', '跳过前 n 条（上次中途失败后从断点继续，避免重复创建）', '0')
    .option('--dry-run', '只校验文件并按目录统计，不创建')
    .option('--json', '输出 JSON')
    .action(async (file, o) => {
      const productId = Number(o.productId);
      const skip = Number(o.skip);
      const created: any[] = [];
      try {
        const cases = readBatchFile(file).slice(skip);

        if (o.dryRun) {
          const bySuite = new Map<string, number>();
          cases.forEach((c) => bySuite.set(c.suite ?? '(无目录)', (bySuite.get(c.suite ?? '(无目录)') ?? 0) + 1));
          bySuite.forEach((n, suite) => console.log(`  ${String(n).padStart(4)}  ${suite}`));
          console.log(`\n共 ${cases.length} 条（跳过前 ${skip} 条），校验通过，未创建（--dry-run）`);
          return;
        }

        const suites: SuiteRef[] = (await apiClient.get('/qc/test/suites', { productId })) ?? [];
        const createSuite = (name: string, parentId: number | null) =>
          apiClient.post('/qc/test/suites', { productId, parentId, name });

        for (const c of cases) {
          const { suite, ...fields } = c;
          const suiteId = suite ? await ensureSuitePath(suite, suites, createSuite) : undefined;
          const r = await apiClient.post('/qc/test/cases', { ...fields, productId, suiteId });
          created.push({ caseNo: r.caseNo, id: r.id, suite: suite ?? null, title: r.title });
          if (!o.json) console.log(`  ＋ ${String(r.caseNo).padEnd(8)} ${suite ?? '-'} › ${r.title}`);
        }

        if (o.json) { console.log(JSON.stringify({ created: created.length, cases: created }, null, 2)); return; }
        console.log(`\n✓ 批量创建完成  新建 ${created.length} 条`);
      } catch (e) {
        if (created.length > 0 || skip > 0) {
          console.error(`已创建 ${created.length} 条；修正后用 --skip ${skip + created.length} 从下一条继续`);
        }
        fail('批量创建失败', e);
      }
    });

  // ── coverage ──────────────────────────────────────────────────────────

  tc.command('coverage <product-id>')
    .description('产品 RP 覆盖率（至少关联 1 条生效用例的 RP ÷ 未归档 RP）')
    .option('--all', '列出全部 RP（默认只列未覆盖）')
    .option('--json', '输出 JSON')
    .action(async (productId, o) => {
      try {
        const cov = await apiClient.get(`/qc/test/products/${productId}/rp-coverage`);
        if (o.json) { console.log(JSON.stringify(cov, null, 2)); return; }
        console.log(`\nRP 覆盖率 — 产品 ${productId}:  ${cov.coverageRate}%  (${cov.coveredRp}/${cov.totalRp})`);
        if (!cov.totalRp) { console.log('该产品没有未归档的 RP。'); return; }
        const rows: any[] = (cov.rulePoints ?? []).filter((rp: any) => o.all || !rp.covered);
        if (!rows.length) { console.log('全部 RP 已覆盖。'); return; }
        console.log(o.all ? '' : '未覆盖 RP:');
        rows.forEach((rp) => console.log(`  ${(rp.code || '').padEnd(14)} ${String(rp.activeCaseCount).padStart(3)} 条  ${rp.statement}`));
        console.log();
      } catch (e) {
        fail('获取 RP 覆盖率失败', e);
      }
    });

  // ── suites ────────────────────────────────────────────────────────────

  tc.command('suites <product-id>')
    .description('查看目录树（取目录 ID 用于 --suite）')
    .option('--json', '输出 JSON')
    .action(async (productId, o) => {
      try {
        const suites: any[] = (await apiClient.get('/qc/test/suites', { productId })) ?? [];
        if (o.json) { console.log(JSON.stringify(suites, null, 2)); return; }
        if (!suites.length) { console.log('该产品还没有目录。'); return; }
        const print = (parentId: number | null, depth: number): void => {
          suites.filter((s) => (s.parentId ?? null) === parentId)
            .forEach((s) => { console.log(`${'  '.repeat(depth)}${s.name}  (ID ${s.id})`); print(s.id, depth + 1); });
        };
        print(null, 0);
      } catch (e) {
        fail('获取目录失败', e);
      }
    });
}

import { Command } from 'commander';
import apiClient from '../../services/ApiClient';

const REASON_CN: Record<string, string> = {
  coding_error:                  '编码错误',
  requirement_misunderstanding:  '需求理解错误',
  boundary_condition_missed:     '边界条件遗漏',
  interface_integration_issue:   '接口联调问题',
  config_issue:                  '配置问题',
  requirement_change_missed:     '需求变更遗漏',
  design_defect:                 '设计缺陷',
  data_issue:                    '数据问题',
  concurrency_issue:             '并发问题',
  test_coverage_missed:          '测试遗漏',
  release_issue:                 '发布问题',
  unclassified:                  '未分类',
};

function riskColor(val: number, ok: number, warn: number, reverse = false): string {
  if (reverse) return val >= ok ? '🟢' : val >= warn ? '🟡' : '🔴';
  return val <= ok ? '🟢' : val <= warn ? '🟡' : '🔴';
}

export function registerReportCommands(qcCommand: Command) {
  const reportCmd = qcCommand
    .command('report')
    .description('质量报表 — 看板、模块分布、原因分析');

  // ── dashboard ─────────────────────────────────────────────────────────

  reportCmd
    .command('dashboard <project-id>')
    .description('输出项目质量看板（7 大指标 + 模块分布 + 原因分析）')
    .option('--start <date>', '统计开始日期 YYYY-MM-DD')
    .option('--end <date>', '统计结束日期 YYYY-MM-DD（不含）')
    .option('--json', '输出 JSON')
    .action(async (projectId, options) => {
      try {
        const params: Record<string, string> = {};
        if (options.start) params.startDate = options.start;
        if (options.end)   params.endDate   = options.end;

        const d = await apiClient.get(`/qc/projects/${projectId}/quality/dashboard`, params);
        if (options.json) { console.log(JSON.stringify(d, null, 2)); return; }

        const s  = d?.statusSummary ?? {};
        const fq = d?.fixQuality ?? {};

        const avgNew      = Number(d?.avgNewBugPerDay ?? 0);
        const reopenRate  = Number(fq?.reopenRate ?? 0) * 100;
        const firstFixRate = Number(fq?.firstFixSuccessRate ?? 0) * 100;

        // ── 总览 ─────────────────────────────────────────────────────────
        console.log(`\n质量看板 — 项目 ${projectId}`);
        if (options.start || options.end) {
          console.log(`统计范围: ${options.start ?? '~'} ～ ${options.end ?? '~'}`);
        }
        console.log('═'.repeat(58));
        console.log(`  总 Bug 数:          ${String(s.totalCount ?? 0).padStart(6)}`);
        console.log(`  未解决 Bug 数:      ${String(s.openCount ?? 0).padStart(6)}`);
        console.log(`  严重 Bug 数:        ${String(s.criticalCount ?? 0).padStart(6)}`);
        console.log(`  已关闭 Bug 数:      ${String(s.closedCount ?? 0).padStart(6)}`);
        console.log('─'.repeat(58));
        console.log(`  日均新增 Bug 数:    ${String(avgNew.toFixed(1)).padStart(6)}  ${riskColor(avgNew, 3, 8)}`);
        console.log(`  一次修复成功率:     ${String(firstFixRate.toFixed(1) + '%').padStart(6)}  ${riskColor(firstFixRate, 80, 60, true)}`);
        console.log(`  Reopen 率:          ${String(reopenRate.toFixed(1) + '%').padStart(6)}  ${riskColor(reopenRate, 10, 20)}`);
        console.log(`  平均修复次数:       ${String(Number(fq?.avgFixCount ?? 0).toFixed(2)).padStart(6)}`);
        console.log('═'.repeat(58));
        console.log('  🟢 正常  🟡 注意  🔴 高风险');

        // ── 模块分布 ─────────────────────────────────────────────────────
        const modules: any[] = d?.moduleBreakdown ?? [];
        if (modules.length) {
          console.log('\n模块 Bug 分布:');
          console.log('  ' + '模块'.padEnd(20) + 'Bug数'.padEnd(7) + '占比'.padEnd(8) + '平均修复(h)'.padEnd(12) + 'Reopen');
          console.log('  ' + '─'.repeat(52));
          modules.forEach((m: any) => {
            const ratio  = ((m.ratio ?? 0) * 100).toFixed(1) + '%';
            const hours  = m.avgResolveHours != null ? Number(m.avgResolveHours).toFixed(1) : '-';
            const reopen = String(m.reopenCount ?? 0);
            console.log(
              '  ' +
              (m.moduleName || '-').substring(0, 18).padEnd(20) +
              String(m.bugCount ?? 0).padEnd(7) +
              ratio.padEnd(8) +
              hours.padEnd(12) +
              reopen
            );
          });
        }

        // ── 按严重度修复时间 ──────────────────────────────────────────────
        const bySev: any[] = d?.resolveTimeBySeverity ?? [];
        if (bySev.length) {
          console.log('\n平均修复时间（按严重度）:');
          console.log('  ' + '严重度'.padEnd(12) + '平均(h)'.padEnd(10) + '已解决数');
          console.log('  ' + '─'.repeat(32));
          bySev.forEach((r: any) => {
            const h = r.avgHours != null ? Number(r.avgHours).toFixed(1) : '-';
            console.log('  ' + (r.severity || '').padEnd(12) + h.padEnd(10) + (r.resolvedCount ?? 0));
          });
        }

        // ── 原因分布 ─────────────────────────────────────────────────────
        const reasons: any[] = d?.reasonBreakdown ?? [];
        if (reasons.length) {
          const totalR = reasons.reduce((s: number, r: any) => s + (r.bugCount ?? 0), 0);
          console.log('\nBug 原因分布:');
          console.log('  ' + '原因分类'.padEnd(22) + 'Bug数'.padEnd(7) + '占比');
          console.log('  ' + '─'.repeat(38));
          reasons.forEach((r: any) => {
            const name  = REASON_CN[r.reasonType] ?? r.reasonType ?? '-';
            const ratio = totalR > 0 ? ((r.bugCount / totalR) * 100).toFixed(1) + '%' : '0.0%';
            console.log('  ' + name.padEnd(22) + String(r.bugCount ?? 0).padEnd(7) + ratio);
          });
        }
        console.log();
      } catch (e) {
        console.error('✗ 获取质量看板失败:', e instanceof Error ? e.message : String(e));
        process.exit(1);
      }
    });
}

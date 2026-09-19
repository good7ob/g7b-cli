import { DASH, dash, fmtDate, fmtNum, renderTable } from '../../../utils/cliHelpers';
import { block } from './kpi';
import { releaseLabel } from './renderForecast';

/** Renderers for `pm health diagnosis` and `pm health explain` (api-0090 §12). */

export interface Finding {
  severity?: string | null;
  code?: string | null;
  message?: string | null;
  data?: Record<string, unknown> | null;
}

export interface ModuleFact {
  projectId?: number | null;
  moduleName?: string | null;
  delayDays?: number | null;
  weightSharePct?: number | null;
  contributionDays?: number | null;
  sharePct?: number | null;
  blockedTasks?: number | null;
}

export interface DiagnosisFacts {
  scope?: { scope?: number | null; completed?: number | null; remaining?: number | null; weightedProgress?: number | null } | null;
  schedule?: { plannedEndDate?: string | null; timeProgressPct?: number | null } | null;
  weightedDelayDays?: number | null;
  modules?: ModuleFact[] | null;
  scopeGrowth?: { baselineScope?: number | null; growthPctOfBaseline?: number | null; netDelta?: number | null; impactDays?: number | null } | null;
  blocked?: { blockedWeight?: number | null; blockedRatioPct?: number | null } | null;
  velocity?: { recentAvg?: number | null; previousAvg?: number | null; changePct?: number | null; trend?: string | null } | null;
}

export interface Diagnosis {
  productId?: number | null;
  releaseId?: number | null;
  weightBasis?: string | null;
  asOfDate?: string | null;
  overallSeverity?: string | null;
  findings?: Finding[] | null;
  facts?: DiagnosisFacts | null;
}

/** `POST …/explain`: always HTTP 200; when the AI cannot be used `aiAvailable` is false and the findings still come back. */
export interface Explain extends Diagnosis {
  aiAvailable?: boolean | null;
  aiGenerated?: boolean | null;
  source?: string | null;
  cached?: boolean | null;
  explanation?: string | null;
  question?: string | null;
  model?: string | null;
  tokensUsed?: number | null;
  aiWarning?: string | null;
}

const SEVERITY: Record<string, string> = { CRITICAL: '严重', WARNING: '警告', INFO: '提示', OK: '正常' };
const TRENDS: Record<string, string> = { IMPROVING: '上升', STABLE: '持平', DECLINING: '下降', INSUFFICIENT_DATA: '数据不足' };

const severity = (s?: string | null) => (s ? `${SEVERITY[s] ?? s} (${s})` : DASH);

export function renderFindings(findings: Finding[]): string {
  if (!findings.length) return '没有发现需要关注的问题。';
  return renderTable([['级别', '代码', '说明']].concat(findings.map((f) => [dash(f.severity), dash(f.code), dash(f.message)])));
}

function renderFacts(facts: DiagnosisFacts): string {
  const v = facts.velocity;
  const g = facts.scopeGrowth;
  return block([
    ['加权进度', fmtNum(facts.scope?.weightedProgress, '%')],
    ['时间进度', fmtNum(facts.schedule?.timeProgressPct, '%', 1)],
    ['计划结束', fmtDate(facts.schedule?.plannedEndDate)],
    ['加权延期', fmtNum(facts.weightedDelayDays, ' 天', 1)],
    ['速度趋势', v ? `${TRENDS[v.trend ?? ''] ?? dash(v.trend)}（近期 ${fmtNum(v.recentAvg)} / 此前 ${fmtNum(v.previousAvg)}，${fmtNum(v.changePct, '%', 1)}）` : DASH],
    ['阻塞占比', fmtNum(facts.blocked?.blockedRatioPct, '%', 1)],
    ['范围增长', g ? `${fmtNum(g.growthPctOfBaseline, '%', 1)}（净增 ${fmtNum(g.netDelta)}，估计影响 ${fmtNum(g.impactDays, ' 天', 0)}）` : DASH],
  ]);
}

function renderModules(modules: ModuleFact[]): string {
  const rows = [['模块', '延期(天)', '范围占比', '延期贡献(天)', '贡献占比', '阻塞任务']].concat(
    modules.map((m) => [
      dash(m.moduleName ?? m.projectId), fmtNum(m.delayDays), fmtNum(m.weightSharePct, '%', 1), fmtNum(m.contributionDays, '', 1),
      fmtNum(m.sharePct, '%', 1), dash(m.blockedTasks),
    ])
  );
  return renderTable(rows, { 0: { truncate: 30 } });
}

export function renderDiagnosis(d: Diagnosis): string {
  const findings = d.findings ?? [];
  const modules = d.facts?.modules ?? [];
  const lines = [
    `进度诊断  产品 #${dash(d.productId)}${releaseLabel(d.releaseId)}    截至 ${fmtDate(d.asOfDate)}    总体 ${severity(d.overallSeverity)}`,
    '─'.repeat(60),
    `发现（${findings.length}）`,
    renderFindings(findings),
  ];
  if (d.facts) lines.push('', '事实', renderFacts(d.facts));
  if (modules.length) lines.push('', '模块（按延期贡献降序）', renderModules(modules));
  lines.push('', '确定性诊断（非 AI）；想要文字解读用 `good7ob pm health explain`。');
  return lines.join('\n');
}

export function renderExplain(e: Explain): string {
  const lines = [
    `AI 解读  产品 #${dash(e.productId)}${releaseLabel(e.releaseId)}    总体 ${severity(e.overallSeverity)}`,
    '─'.repeat(60),
  ];
  if (e.question) lines.push(`问题: ${e.question}`, '');
  if (e.aiAvailable && e.explanation) {
    lines.push('── AI 生成，仅供参考，需人工确认 ──', e.explanation, '──────────────');
    lines.push(
      [`模型 ${dash(e.model)}`, `tokens ${dash(e.tokensUsed)}`, e.cached ? '缓存命中（未再调用模型、未再扣费）' : null].filter(Boolean).join(' · ')
    );
  } else {
    lines.push(`⚠ AI 解读不可用：${e.aiWarning ?? '未知原因'}（下方的确定性诊断不受影响）`);
  }
  lines.push('', '确定性诊断（非 AI）', renderFindings(e.findings ?? []));
  return lines.join('\n');
}

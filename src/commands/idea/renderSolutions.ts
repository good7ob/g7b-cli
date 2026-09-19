import { ApiDate, dash, fmtDate, fmtNum, renderTable } from '../../utils/cliHelpers';

export interface IdeaKpi {
  name?: string | null;
  current?: string | null;
  target?: string | null;
  unit?: string | null;
}

export interface IdeaSolution {
  id: number;
  ideaId?: number;
  name?: string | null;
  description?: string | null;
  costNote?: string | null;
  cycleNote?: string | null;
  expectedEffectNote?: string | null;
  isSelected?: boolean | null;
  decisionReason?: string | null;
  decidedBy?: number | null;
  decidedAt?: ApiDate;
  // A1 structured estimate (all nullable; V111-era rows have none)
  effortDaysFrontend?: number | null;
  effortDaysBackend?: number | null;
  effortDaysAi?: number | null;
  effortDaysTest?: number | null;
  effortDaysPm?: number | null;
  totalEffortDays?: number | null;
  estimatedCost?: number | null;
  cloudCostMonthly?: number | null;
  aiTokenCostMonthly?: number | null;
  maintenanceCost?: number | null;
  cycleWeeks?: number | null;
  technicalRisk?: string | null;
  productRisk?: string | null;
  expectedEffect?: string | null;
  kpi?: IdeaKpi[] | null;
  confidence?: string | null;
  estimationSource?: string | null;
  rejectionReason?: string | null;
}

export interface IdeaDecision {
  id?: number | null;
  ideaId?: number;
  selectedSolutionId?: number | null;
  decidedBy?: number | null;
  decidedAt?: ApiDate;
  reason?: string | null;
  approvalStatus?: string | null;
  approvalId?: number | null;
}

const ESTIMATE_KEYS: Array<keyof IdeaSolution> = [
  'effortDaysFrontend', 'effortDaysBackend', 'effortDaysAi', 'effortDaysTest', 'effortDaysPm', 'totalEffortDays',
  'estimatedCost', 'cloudCostMonthly', 'aiTokenCostMonthly', 'maintenanceCost', 'cycleWeeks', 'technicalRisk',
  'productRisk', 'expectedEffect', 'kpi', 'confidence', 'rejectionReason',
];

const hasValue = (v: unknown) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0);
const hasEstimate = (s: IdeaSolution) => ESTIMATE_KEYS.some((k) => hasValue(s[k])) || s.estimationSource === 'ai';

function fmtKpi(k: IdeaKpi): string {
  const unit = k.unit ? ` ${k.unit}` : '';
  return `${dash(k.name)}: ${dash(k.current)} → ${dash(k.target)}${unit}`;
}

/** [row label, cell for one solution] — rendered transposed so solutions sit side by side. */
const ESTIMATE_ROWS: Array<[string, (s: IdeaSolution) => string]> = [
  ['总人日', (s) => fmtNum(s.totalEffortDays)],
  ['人日明细', (s) => [`前端 ${fmtNum(s.effortDaysFrontend)}`, `后端 ${fmtNum(s.effortDaysBackend)}`, `AI ${fmtNum(s.effortDaysAi)}`, `测试 ${fmtNum(s.effortDaysTest)}`, `PM ${fmtNum(s.effortDaysPm)}`].join('\n')],
  ['预计成本', (s) => fmtNum(s.estimatedCost)],
  ['月度成本', (s) => [`云 ${fmtNum(s.cloudCostMonthly)}`, `Token ${fmtNum(s.aiTokenCostMonthly)}`, `维护 ${fmtNum(s.maintenanceCost)}`].join('\n')],
  ['周期', (s) => fmtNum(s.cycleWeeks, ' 周')],
  ['技术风险', (s) => dash(s.technicalRisk)],
  ['产品风险', (s) => dash(s.productRisk)],
  ['可信度', (s) => `${dash(s.confidence)}${s.estimationSource === 'ai' ? ' [AI 估算]' : ''}`],
  ['预期效果', (s) => dash(s.expectedEffect)],
  ['KPI', (s) => (s.kpi?.length ? s.kpi.map(fmtKpi).join('\n') : dash(null))],
  ['落选原因', (s) => dash(s.rejectionReason)],
];

/** Solutions as columns, estimate dimensions as rows. Empty when no solution carries any estimate. */
export function renderEstimateComparison(solutions: IdeaSolution[]): string[] {
  if (!solutions.some(hasEstimate)) return [];
  const wrap = { width: 26, wrapWord: false };
  const header = [''].concat(solutions.map((s) => `#${s.id} ${dash(s.name)}${s.isSelected ? ' ✓' : ''}`));
  const rows = [header].concat(ESTIMATE_ROWS.map(([label, cell]) => [label, ...solutions.map(cell)]));
  const columns = Object.fromEntries(solutions.map((_, i) => [i + 1, wrap]));
  return ['', '估算对比（月度成本均为每月）', renderTable(rows, columns)];
}

/** Decision line: from the decision row when there is one, else from the solution flagged selected (MVP). */
export function renderDecision(solutions: IdeaSolution[], decision?: IdeaDecision | null): string[] {
  if (decision?.selectedSolutionId) {
    const chosen = solutions.find((s) => s.id === decision.selectedSolutionId);
    const approval = decision.approvalStatus ? `；审批: ${decision.approvalStatus}${decision.approvalId ? ` (审批单 #${decision.approvalId})` : ''}` : '';
    return [`决策: 选定 #${decision.selectedSolutionId} ${dash(chosen?.name)} — ${dash(decision.reason)}（by ${dash(decision.decidedBy)} @ ${fmtDate(decision.decidedAt)}）${approval}`];
  }
  return solutions.filter((s) => s.isSelected).map((s) =>
    `决策: 选定 #${s.id} ${dash(s.name)} — ${dash(s.decisionReason)}（by ${dash(s.decidedBy)} @ ${fmtDate(s.decidedAt)}）`);
}

export function renderSolutions(solutions: IdeaSolution[], decision?: IdeaDecision | null): string[] {
  if (!solutions.length) return ['方案: (暂无方案，用 idea solution add 添加)'];
  const wrap = { width: 22, wrapWord: false };
  const rows = [['ID', '方案', '成本', '周期', '预期效果', '选中']].concat(
    solutions.map((s) => [
      String(s.id), dash(s.name), dash(s.costNote), dash(s.cycleNote), dash(s.expectedEffectNote),
      s.isSelected ? '✓' : '',
    ])
  );
  return [
    `方案 (${solutions.length})`,
    renderTable(rows, { 1: wrap, 2: wrap, 3: wrap, 4: wrap }),
    ...renderEstimateComparison(solutions),
    ...renderDecision(solutions, decision),
  ];
}

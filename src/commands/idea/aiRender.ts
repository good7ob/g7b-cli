import { DASH, dash, fmtNum, renderTable } from '../../utils/cliHelpers';
import { IdeaSolution, renderEstimateComparison } from './renderSolutions';

export interface DimensionCorrection {
  factor?: number | null;
  sampleSize?: number | null;
  insufficientHistory?: boolean | null;
}

export interface EstimationCorrection {
  productId?: number;
  effort?: DimensionCorrection | null;
  cycle?: DimensionCorrection | null;
  cost?: DimensionCorrection | null;
}

export interface GenerateResult {
  solutions?: IdeaSolution[] | null;
  correction?: EstimationCorrection | null;
  model?: string | null;
  tokensUsed?: number | null;
  estimationSource?: string | null;
}

const DIMENSIONS: Array<[keyof EstimationCorrection, string]> = [['effort', '人日'], ['cycle', '周期'], ['cost', '成本']];

/** Factor per dimension; < 3 historical samples means factor 1.000 = no correction applied. */
export function renderCorrectionTable(c: EstimationCorrection | null | undefined): string {
  const rows = [['维度', '系数', '样本数', '说明']].concat(
    DIMENSIONS.map(([key, label]) => {
      const d = c?.[key] as DimensionCorrection | null | undefined;
      const note = !d ? DASH : d.insufficientHistory ? '历史样本不足（<3），未修正' : '已按历史偏差修正';
      return [label, d ? fmtNum(d.factor, '', 3) : DASH, d ? dash(d.sampleSize) : DASH, note];
    })
  );
  return renderTable(rows);
}

export function renderCorrection(c: EstimationCorrection): string {
  return [
    `估算修正系数 — 产品 #${dash(c?.productId)}（系数 = 已完成复盘中 实际 ÷ 预期 的均值，限幅 0.5~3.0，需 ≥3 个样本；新生成的 AI 估算会乘以它）`,
    renderCorrectionTable(c),
  ].join('\n');
}

export function renderGenerated(ideaId: number, result: GenerateResult): string {
  const solutions = result.solutions ?? [];
  const lines = [
    `✓ 已为 Idea #${ideaId} 生成 ${solutions.length} 个候选方案 [AI 估算]  模型: ${dash(result.model)}  Token: ${dash(result.tokensUsed)}`,
    '⚠ 以下人日 / 成本 / 周期均为 AI 估算（已乘以历史修正系数），仅供参考；请人工核对（idea solution update）后再 idea select',
    ...solutions.map((s) => `  #${s.id} ${dash(s.name)}`),
    ...renderEstimateComparison(solutions),
  ];
  if (result.correction) lines.push('', '本次采用的修正系数:', renderCorrectionTable(result.correction));
  return lines.join('\n');
}

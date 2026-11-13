import { dash, fmtDateTime, renderTable } from '../../utils/cliHelpers';

const SOURCE: Record<string, string> = { structured: '点选', implicit: '隐式', platform_question: '平台提问' };
const REVIEW: Record<string, string> = { unreviewed: '未复核', confirmed: '已确认', corrected: '已修正', excluded: '已排除' };
const CHOICE: Record<string, string> = { option: '选项', multi: '多选', custom: '自填', free_text: '自由文本' };
const DOMAIN: Record<string, string> = {
  product_scope: '产品范围', architecture: '架构', database: '数据库', deploy_release: '部署发布', process_workflow: '流程协作',
  quality_test: '质量测试', security_compliance: '安全合规', billing_pricing: '计费定价', other: '其他',
};

const label = (map: Record<string, string>, v: unknown, empty = '—') => (v ? map[String(v)] ?? String(v) : empty);
const oneLine = (s: unknown, max: number) => {
  const chars = Array.from(String(s ?? '').replace(/\s+/g, ' ').trim());
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : chars.join('');
};

export interface DecisionOptionView { label: string; description?: string | null; recommended?: boolean }
export interface Decision {
  id: number; sourceKind: string; question: string; choiceText: string; choiceType: string; isRecommendedChosen: boolean;
  domain?: string | null; reviewStatus: string; occurredAt: number; batchId?: string | null;
  sourceKey?: string; client?: string; sessionRef?: string | null; productId?: number | null; taskId?: number | null;
  situationUser?: string | null; situationAssistant?: string | null; options?: DecisionOptionView[];
  rationale?: string | null; confidence?: number | null; version?: number; createdAt?: number; updatedAt?: number;
}
export interface DecisionPage { total?: number; page?: number; pageSize?: number; items?: Decision[] }

export function renderDecisions(data: DecisionPage | null | undefined): string {
  const items = data?.items ?? [];
  if (items.length === 0) return '没有决策记录';
  const rows = items.map((d) => [
    String(d.id), fmtDateTime(d.occurredAt), label(REVIEW, d.reviewStatus), label(DOMAIN, d.domain, '未分类'),
    `${label(CHOICE, d.choiceType)}${d.isRecommendedChosen ? '·荐' : ''}`, d.confidence == null ? '-' : String(d.confidence), oneLine(d.question, 40), oneLine(d.choiceText, 30),
  ]);
  const table = renderTable([['ID', '时间(JST)', '复核', '领域', '选择', '把握', '问题', '选了'], ...rows]);
  return `${table}\n共 ${data?.total ?? items.length} 条，第 ${data?.page ?? 1} 页（每页 ${data?.pageSize ?? items.length}）`;
}

export function renderDecision(d: Decision): string {
  const head = `#${d.id}  ${label(SOURCE, d.sourceKind)}  ${label(REVIEW, d.reviewStatus)}  领域 ${label(DOMAIN, d.domain, '未分类')}  版本 ${dash(d.version)}`;
  const options = (d.options ?? []).map((o) => `  - ${o.label}${o.recommended ? '（推荐）' : ''}${o.description ? `：${oneLine(o.description, 120)}` : ''}`);
  const lines = [
    head,
    `时间：${fmtDateTime(d.occurredAt)} JST    批次：${dash(d.batchId)}    会话：${dash(d.sessionRef)}`,
    `问题：${d.question}`,
    ...(options.length ? ['候选：', ...options] : []),
    `选择：${d.choiceText}（${label(CHOICE, d.choiceType)}${d.isRecommendedChosen ? '，选了推荐项' : ''}）`,
    `理由：${dash(d.rationale)}`,
    `把握度：${dash(d.confidence)}`,
    `${d.sourceKind === 'implicit' ? '本人原回复' : '用户原话'}：${dash(oneLine(d.situationUser, 300))}`,
    `助手上文：${dash(oneLine(d.situationAssistant, 300))}`,
    `创建：${fmtDateTime(d.createdAt)}    更新：${fmtDateTime(d.updatedAt)}`,
  ];
  return lines.join('\n');
}

export function renderReviewed(d: Decision, verb: string): string {
  return `✓ 已${verb}决策 #${d.id}（${label(REVIEW, d.reviewStatus)}，版本 ${dash(d.version)}）`;
}

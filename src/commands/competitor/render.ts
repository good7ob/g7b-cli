import { ApiDate, DASH, dash, fmtDate, renderTable } from '../../utils/cliHelpers';

export interface SourceSummary { credibility?: string | null; lastVerifiedOn?: string | null; flags?: string[] }
export interface CompetitorRow {
  id: number; name: string; positioning?: string | null; targetUsers?: string | null; pricing?: string | null; websiteUrl?: string | null;
  threatLevel?: string; note?: string | null; version?: number; sourceSummary?: SourceSummary;
}
export interface CapabilityRow { id: number; name: string; note?: string | null; refType?: string | null; refId?: number | null; refName?: string | null; refDeleted?: boolean }
export interface SourceRow {
  id: number; targetType?: string; title: string; url?: string | null; credibility?: string; verifiedOn?: string | null; version?: number;
}
export interface CellRow {
  capabilityId: number; competitorId: number | null; value: string; note?: string | null; fillMode?: string; humanTouched?: boolean;
  version?: number; credibility?: string | null; lastVerifiedOn?: string | null; flags?: string[]; sources?: SourceRow[];
}
export interface Matrix {
  competitors: CompetitorRow[]; capabilities: CapabilityRow[]; cells: CellRow[];
  summary?: Record<string, number>; permissions?: { canEdit?: boolean; canConvertToIdea?: boolean; canAiFill?: boolean };
}
interface Related { id: number; name: string; deleted?: boolean }
export interface OpportunityRow {
  id: number; kind: string; title: string; description?: string | null; status: string; origin?: string; version?: number;
  capability?: Related | null; competitors?: Related[]; idea?: { id: number; title: string; status: string; deleted?: boolean } | null;
  createdAt?: ApiDate;
}
export interface ConvertResult {
  converted?: boolean; alreadyConverted?: boolean;
  similarIdeas?: Array<{ id: number; title: string; status: string; rejectReason?: string | null; similarity: number }>;
  idea?: { id: number; title: string; status: string } | null; opportunity?: { id: number; status: string; version: number } | null;
}

const empty = (what: string) => `(没有${what})`;
const wrap = (width: number) => ({ width, wrapWord: false });

const THREAT: Record<string, string> = { HIGH: '高', MEDIUM: '中', LOW: '低' };
const CRED: Record<string, string> = { PRIMARY: '一手', SECONDARY: '二手', UNVERIFIED: '未核实' };
const KIND: Record<string, string> = { OPPORTUNITY: '机会', GAP: '差距' };
const STATUS: Record<string, string> = { PENDING: '待处理', CONVERTED: '已转想法', IGNORED: '已忽略' };
const VALUE: Record<string, string> = { YES: '✓ 有', PARTIAL: '◐ 部分', NO: '✗ 无', UNKNOWN: '? 未知' };
const FLAG: Record<string, string> = { NO_SOURCE: '无来源', STALE: '已过期', AI_FILLED: 'AI 填写待确认' };

export const flagText = (flags?: string[]) => (flags ?? []).map((f) => FLAG[f] ?? f).join('、');
const cred = (s?: string | null) => (s ? CRED[s] ?? s : DASH);

export function renderCompetitors(rows: CompetitorRow[]): string {
  if (!rows.length) return empty('竞品');
  return renderTable([['ID', 'NAME', 'THREAT', 'POSITIONING', 'PRICING', 'SOURCE', 'VERIFIED', 'FLAGS'],
    ...rows.map((c) => [String(c.id), c.name, THREAT[c.threatLevel ?? ''] ?? dash(c.threatLevel), dash(c.positioning), dash(c.pricing),
      cred(c.sourceSummary?.credibility), dash(c.sourceSummary?.lastVerifiedOn), dash(flagText(c.sourceSummary?.flags))])],
  { 1: wrap(24), 3: wrap(30), 4: wrap(24) });
}

export function renderCompetitor(c: CompetitorRow): string {
  const s = c.sourceSummary ?? {};
  return [
    `${c.name}   威胁: ${THREAT[c.threatLevel ?? ''] ?? dash(c.threatLevel)}   (id ${c.id}, v${dash(c.version)})`,
    `一句话定位: ${dash(c.positioning)}`, `目标用户: ${dash(c.targetUsers)}`, `定价: ${dash(c.pricing)}`, `官网: ${dash(c.websiteUrl)}`,
    `备注: ${dash(c.note)}`, `来源: ${cred(s.credibility)}   最近核实: ${dash(s.lastVerifiedOn)}   ${flagText(s.flags)}`.trimEnd(),
  ].join('\n');
}

export function renderCapabilities(rows: CapabilityRow[]): string {
  if (!rows.length) return empty('能力项');
  return renderTable([['ID', 'NAME', 'FROM', 'NOTE'],
    ...rows.map((r) => [String(r.id), r.name, r.refType ? `${r.refType}#${r.refId}${r.refDeleted ? '（原对象已删除）' : ''}` : '自定义', dash(r.note)])],
  { 1: wrap(36), 3: wrap(36) });
}

export function renderAdded(result: { added?: CapabilityRow[]; skipped?: Array<{ refType?: string | null; refId?: number | null; name?: string | null; reason?: string }> }): string {
  const lines = [`✓ 已添加 ${(result.added ?? []).length} 项`, ...(result.added ?? []).map((a) => `  + #${a.id} ${a.name}`)];
  for (const s of result.skipped ?? []) lines.push(`  - 跳过 ${s.name ?? `${s.refType}#${s.refId}`}: ${dash(s.reason)}`);
  return lines.join('\n');
}

/** The cell text: value, an AI mark until a person confirms, a star when flagged. */
function cellText(cell?: CellRow): string {
  if (!cell) return VALUE.UNKNOWN;
  const flags = cell.flags ?? [];
  return `${VALUE[cell.value] ?? cell.value}${flags.includes('AI_FILLED') ? ' (AI)' : ''}${flags.some((f) => f !== 'AI_FILLED') ? ' *' : ''}`;
}

export function renderMatrix(m: Matrix): string {
  if (!m.capabilities.length) return empty('能力项，先用 competitor capability add 添加');
  const at = new Map(m.cells.map((c) => [`${c.capabilityId}:${c.competitorId ?? 'own'}`, c]));
  const head = ['CAPABILITY', '本产品', ...m.competitors.map((c) => c.name)];
  const rows = m.capabilities.map((cap) => [`${cap.name}${cap.refDeleted ? '（原对象已删除）' : ''}`, cellText(at.get(`${cap.id}:own`)),
    ...m.competitors.map((c) => cellText(at.get(`${cap.id}:${c.id}`)))]);
  const s = m.summary ?? {};
  const lines = [renderTable([head, ...rows], { 0: wrap(30) }),
    `竞品 ${dash(s.competitorCount)}  能力项 ${dash(s.capabilityCount)}  未知格 ${dash(s.unknownCellCount)}  无来源 ${dash(s.noSourceCount)}  已过期 ${dash(s.staleCount)}  待处理机会点 ${dash(s.pendingOpportunityCount)}`,
    '图例: * 无来源或来源已过期；(AI) AI 填写、待人工确认'];
  if (m.permissions) lines.push(`你的权限: ${m.permissions.canEdit ? '可编辑' : '只读'}${m.permissions.canAiFill ? '，可触发 AI 填写' : ''}`);
  return lines.join('\n');
}

export function renderCell(c: CellRow): string {
  return `${VALUE[c.value] ?? c.value}  备注: ${dash(c.note)}  方式: ${c.fillMode === 'AI' && !c.humanTouched ? 'AI 填写（待确认）' : '人工'}  (v${dash(c.version)})`;
}

export function renderSources(rows: SourceRow[]): string {
  if (!rows.length) return empty('来源');
  return renderTable([['ID', 'TITLE', 'CREDIBILITY', 'VERIFIED', 'URL'],
    ...rows.map((s) => [String(s.id), s.title, cred(s.credibility), dash(s.verifiedOn), dash(s.url)])], { 1: wrap(36), 4: wrap(48) });
}

export function renderOpportunities(rows: OpportunityRow[]): string {
  if (!rows.length) return empty('机会点');
  return renderTable([['ID', 'KIND', 'STATUS', 'TITLE', 'CAPABILITY', 'COMPETITORS', 'IDEA', 'CREATED'],
    ...rows.map((o) => [String(o.id), KIND[o.kind] ?? o.kind, STATUS[o.status] ?? o.status, o.title, dash(o.capability?.name),
      dash((o.competitors ?? []).map((c) => c.name).join('、')), o.idea ? `#${o.idea.id} ${o.idea.title}${o.idea.deleted ? '（已删除）' : `（${o.idea.status}）`}` : DASH,
      o.createdAt ? fmtDate(o.createdAt) : DASH])], { 3: wrap(36), 6: wrap(30) });
}

export function renderConvert(r: ConvertResult, id: number): string {
  if (r.alreadyConverted) return `该机会点已转为想法 #${r.idea?.id} ${dash(r.idea?.title)}（${dash(r.idea?.status)}）`;
  if (r.converted) return `✓ 机会点 #${id} 已转为想法 #${r.idea?.id} ${dash(r.idea?.title)}（${dash(r.idea?.status)}）`;
  const similar = r.similarIdeas ?? [];
  return [`发现 ${similar.length} 个相似想法，没有创建任何东西:`,
    ...similar.map((s) => `  - #${s.id} ${s.title}（${s.status}，相似度 ${Math.round(s.similarity * 100)}%${s.rejectReason ? `，驳回原因: ${s.rejectReason}` : ''}）`),
    `仍要新建: competitor opportunity convert ${id} --mode create`, `关联已有想法: competitor opportunity convert ${id} --mode link --idea <想法id>`].join('\n');
}

export interface AiFillResult {
  succeeded?: number; failed?: number; skipped?: number; model?: string;
  tokenUsage?: { inputTokens?: number; outputTokens?: number };
  results?: Array<{ capabilityId: number; status: string; value?: string; reason?: string }>;
}

export function renderAiFill(r: AiFillResult): string {
  const t = r.tokenUsage ?? {};
  return [`✓ AI 填写完成: 成功 ${dash(r.succeeded)}  失败 ${dash(r.failed)}  跳过 ${dash(r.skipped)}   模型 ${dash(r.model)}   token ${dash(t.inputTokens)}/${dash(t.outputTokens)}（输入/输出）`,
    ...(r.results ?? []).filter((x) => x.status !== 'OK').map((x) => `  - 能力项 #${x.capabilityId}: ${x.status}${x.reason ? `（${x.reason}）` : ''}`),
    '写入的格标为「AI 填写」，请用 competitor matrix 查看，确认用 competitor cell confirm'].join('\n');
}


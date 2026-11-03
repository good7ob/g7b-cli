import { ApiDate, DASH, dash, fmtDateTime, renderTable } from '../../utils/cliHelpers';

export interface Freshness { state?: string; label?: string; upToDate?: boolean; reason?: string | null }
export interface RenderRef { id?: number; sourceSha256?: string; renderedAt?: ApiDate; plantumlVersion?: string; objectFileId?: number }
export interface Mark { code: string; label: string }
export interface UcListItem {
  id: number; code: string; actorName?: string; actorDisabled?: boolean; goal: string; priority: string; channels?: string[];
  subModuleName?: string | null; functionPointCount?: number; noFunctionPoint?: boolean;
  status?: string; statusLabel?: string; gaps?: Mark[]; reachSummary?: string | null; diagramStatus?: string; diagramStatusLabel?: string;
}
export interface UcPage { records?: UcListItem[]; total?: number; current?: number; pages?: number }
interface FpLink { functionPointId: number; code?: string | null; name?: string | null; reqStatus?: string | null; implStatus?: string | null; invalid?: boolean; invalidReason?: string | null }
interface TestLink { testCaseId: number; caseNo?: string | null; title?: string | null; latestResult?: string; missing?: boolean }
interface Rel { relationId: number; type: string; code: string; goal: string; triggerCondition?: string | null }
interface ChannelEntries { channel: string; entries: Array<{ id: number; entryRef: string; functionPointId: number }> }
export interface UcDetail extends UcListItem {
  productId?: number; note?: string | null; targetReleaseId?: number | null; targetMilestoneId?: number | null;
  channelEntries?: ChannelEntries[]; functionPoints?: FpLink[]; testCases?: TestLink[];
  relations?: { includes?: Rel[]; includedBy?: Rel[]; extendsTo?: Rel[]; extendedBy?: Rel[] };
}
export interface Actor { id: number; name: string; enabled: boolean; useCaseCount?: number }
export interface DiagramRow {
  id: number; name: string; diagramType?: string; currentVersionNo?: number; freshness?: Freshness; latestRender?: RenderRef | null;
}
export interface OverviewRow {
  key: string; name: string; useCaseCount?: number; oversized?: boolean; hint?: string | null; freshness?: Freshness; latestRender?: RenderRef | null;
  source?: string; sourceSha256?: string;
}

/** 「缺入口声明、缺流程图」; no gaps -> 无. */
export const gapText = (gaps?: Mark[]) => (gaps?.length ? gaps.map((g) => g.label).join('、') : '无');
const empty = (what: string) => `(没有${what})`;
const wrap = (width: number) => ({ width, wrapWord: false });

export function renderList(page: UcPage): string {
  const rows = page.records ?? [];
  if (!rows.length) return empty('用例');
  const table = renderTable([['CODE', 'PRI', 'STATUS', 'ACTOR', 'GOAL', 'CHANNELS', 'FP', 'GAPS', 'DIAGRAM'],
    ...rows.map((u) => [u.code, u.priority, dash(u.statusLabel), `${dash(u.actorName)}${u.actorDisabled ? '（已停用）' : ''}`, u.goal,
      (u.channels ?? []).join(','), u.noFunctionPoint ? '未关联' : dash(u.functionPointCount), gapText(u.gaps), dash(u.diagramStatusLabel)])],
  { 4: wrap(36), 7: wrap(36) });
  return `${table}\n共 ${page.total ?? rows.length} 条（第 ${page.current ?? 1}/${page.pages ?? 1} 页）`;
}

const fpLine = (f: FpLink) => `  - ${dash(f.code)} ${dash(f.name)}  实现: ${dash(f.implStatus)}  需求: ${dash(f.reqStatus)}${f.invalid ? `  [已失效: ${dash(f.invalidReason)}]` : ''}  (id ${f.functionPointId})`;
const testLine = (t: TestLink) => `  - ${dash(t.caseNo)} ${dash(t.title)}  最近结果: ${dash(t.latestResult)}${t.missing ? '  [已被删除或不可读]' : ''}  (id ${t.testCaseId})`;
const relLine = (verb: string, r: Rel) => `  - ${verb} ${r.code} ${r.goal}${r.triggerCondition ? `（触发: ${r.triggerCondition}）` : ''}  (关系 ${r.relationId})`;

export function renderDetail(u: UcDetail): string {
  const lines = [
    `${u.code}  ${u.goal}   [${u.priority}]  (id ${u.id})`,
    `角色: ${dash(u.actorName)}${u.actorDisabled ? '（已停用）' : ''}    子模块: ${dash(u.subModuleName)}    目标 Release: ${dash(u.targetReleaseId)}    目标里程碑: ${dash(u.targetMilestoneId)}`,
  ];
  if (u.statusLabel) lines.push(`状态: ${u.statusLabel}    缺口: ${gapText(u.gaps)}${u.reachSummary ? `    ${u.reachSummary}` : ''}    流程图: ${dash(u.diagramStatusLabel)}（详见 uc status）`);
  if (u.note) lines.push(`补充说明: ${u.note}`);
  lines.push('要求渠道与入口声明:');
  for (const c of u.channelEntries ?? []) {
    lines.push(c.entries.length
      ? `  ${c.channel}: ${c.entries.map((e) => `${e.entryRef} (入口 ${e.id}, FP ${e.functionPointId})`).join('；')}`
      : `  ${c.channel}: ⚠ 未声明入口`);
  }
  const fps = u.functionPoints ?? [];
  lines.push(fps.length ? `关联 FP (${fps.length}):` : '关联 FP: ⚠ 未关联 FP', ...fps.map(fpLine));
  const tests = u.testCases ?? [];
  lines.push(`关联测试用例 (${tests.length}):`, ...tests.map(testLine));
  const r = u.relations ?? {};
  const rels = [
    ...(r.includes ?? []).map((x) => relLine('include →', x)), ...(r.includedBy ?? []).map((x) => relLine('被 include ←', x)),
    ...(r.extendsTo ?? []).map((x) => relLine('extend →', x)), ...(r.extendedBy ?? []).map((x) => relLine('被 extend ←', x)),
  ];
  lines.push(`关系 (${rels.length}):`, ...rels);
  return lines.join('\n');
}

export function renderActors(list: Actor[]): string {
  if (!list.length) return empty('角色');
  return renderTable([['ID', 'NAME', 'ENABLED', 'USE CASES'],
    ...list.map((a) => [String(a.id), a.name, a.enabled ? '✓' : '已停用', dash(a.useCaseCount)])]);
}

export function renderFpCandidates(list: FpLink[]): string {
  if (!list.length) return empty('候选 FP');
  return renderTable([['ID', 'CODE', 'NAME', 'REQ', 'IMPL', 'INVALID'],
    ...list.map((f) => [String(f.functionPointId), dash(f.code), dash(f.name), dash(f.reqStatus), dash(f.implStatus), f.invalid ? dash(f.invalidReason) : ''])], { 2: wrap(40) });
}

export function renderTestCandidates(list: TestLink[]): string {
  if (!list.length) return empty('候选测试用例');
  return renderTable([['ID', 'CASE NO', 'TITLE', 'LATEST'],
    ...list.map((t) => [String(t.testCaseId), dash(t.caseNo), dash(t.title), dash(t.latestResult)])], { 2: wrap(40) });
}

const renderedAt = (r?: RenderRef | null) => (r ? fmtDateTime(r.renderedAt) : '—');
const fresh = (f?: Freshness) => dash(f?.label ?? f?.state);

export function renderDiagrams(list: DiagramRow[]): string {
  if (!list.length) return empty('流程图');
  return renderTable([['ID', 'NAME', 'TYPE', 'VER', 'STATE', 'RENDERED'],
    ...list.map((d) => [String(d.id), d.name, dash(d.diagramType), dash(d.currentVersionNo), fresh(d.freshness), renderedAt(d.latestRender)])]);
}

export function renderOverviews(list: OverviewRow[]): string {
  if (!list.length) return empty('总图（产品里还没有用例）');
  return renderTable([['KEY', 'NAME', 'USE CASES', 'STATE', 'RENDERED', 'NOTE'],
    ...list.map((o) => [o.key, o.name, dash(o.useCaseCount), fresh(o.freshness), renderedAt(o.latestRender), o.oversized ? dash(o.hint) : ''])], { 5: wrap(30) });
}

export interface BatchItem { label: string; ok: boolean; message: string }

export function renderBatch(items: BatchItem[], skipped: number): string {
  const failed = items.filter((i) => !i.ok);
  const head = `渲染 ${items.length} 张：成功 ${items.length - failed.length}，失败 ${failed.length}${skipped ? `；${skipped} 张已是最新，跳过` : ''}`;
  return [head, ...items.map((i) => `${i.ok ? '✓' : '✗'} ${i.label}: ${i.message}`)].join('\n');
}

// ── status / metrics / gaps (api-0180 §14) ──

interface StatusEntry { entryRef: string; functionPointCode?: string | null; functionPointName?: string | null; reqStatus?: string | null; implStatus?: string | null; state?: string; stateLabel?: string }
export interface StatusView {
  code: string; status: string; statusLabel: string; usable?: boolean; reasons?: string[];
  channels?: Array<{ channel: string; reachable: boolean; reasons?: Mark[]; entries?: StatusEntry[] }>;
  gaps?: Mark[]; reachSummary?: string | null;
  verification?: { passed?: boolean; missing?: Mark[]; testCaseCount?: number; testsPassed?: number; testsFailed?: number; testsNotRun?: number };
  includes?: Array<{ code: string; goal: string; statusLabel: string; usable?: boolean }>;
  functionPointCount?: number; diagramCount?: number; diagramStatusLabel?: string;
}

export function renderStatus(v: StatusView): string {
  const lines = [`${v.code}  状态: ${v.statusLabel}${v.usable ? '（可用）' : ''}`];
  if (v.reasons?.length) lines.push('原因:', ...v.reasons.map((r) => `  - ${r}`));
  lines.push('渠道可达性:');
  for (const c of v.channels ?? []) {
    lines.push(`  ${c.channel}: ${c.reachable ? '✓ 已可达' : `✗ 未可达（${gapText(c.reasons)}）`}`);
    for (const e of c.entries ?? []) {
      lines.push(`      ${e.entryRef}  ${dash(e.functionPointCode)} ${dash(e.functionPointName)}（需求 ${dash(e.reqStatus)}，实现 ${dash(e.implStatus)}）[${dash(e.stateLabel ?? e.state)}]`);
    }
  }
  lines.push(`缺口: ${gapText(v.gaps)}`);
  if (v.reachSummary) lines.push(v.reachSummary);
  const ver = v.verification;
  if (ver) {
    const counts = `关联测试 ${dash(ver.testCaseCount)} 条（通过 ${dash(ver.testsPassed)}，失败 ${dash(ver.testsFailed)}，未执行或无法判定 ${dash(ver.testsNotRun)}）；流程图 ${dash(v.diagramCount)} 份（${dash(v.diagramStatusLabel)}）`;
    lines.push(ver.passed ? `验证: 测试与流程图均已满足    ${counts}` : `验证: 未达已验证，缺: ${ver.missing?.length ? ver.missing.map((m) => m.label).join('；') : '无'}    ${counts}`);
  }
  const inc = v.includes ?? [];
  lines.push(`include 的用例 (${inc.length}):`, ...inc.map((i) => `  - ${i.code} ${i.goal}  [${i.statusLabel}${i.usable ? '' : '，未达可用'}]`));
  return lines.join('\n');
}

export interface Bucket { priority: string; total: number; distribution?: Record<string, number>; usable: number; verified: number; usableRate: number | null; verifiedRate: number | null }
export interface Metrics { productId?: number; releaseId?: number | null; milestoneId?: number | null; total: number; p0: Bucket; p1: Bucket; p2: Bucket; overall: Bucket }

/** A 0-1 fraction as a percentage; null (nothing to divide) is 「—」, never 0%. */
export function fmtRate(rate: number | null | undefined): string {
  return rate === null || rate === undefined || Number.isNaN(Number(rate)) ? DASH : `${Number((Number(rate) * 100).toFixed(1))}%`;
}

const DIST: Array<[string, string]> = [['NOT_STARTED', '未开始'], ['PARTIAL', '部分'], ['AVAILABLE', '可用'], ['VERIFIED', '已验证']];
const distText = (b: Bucket) => DIST.map(([k, label]) => `${label} ${b.distribution?.[k] ?? 0}`).join(' | ');
const bucketName = (b: Bucket) => (b.priority === 'ALL' ? '合计' : b.priority);

export function renderMetrics(m: Metrics): string {
  const scope = [m.releaseId != null ? `Release ${m.releaseId}` : null, m.milestoneId != null ? `里程碑 ${m.milestoneId}` : null].filter(Boolean).join('，') || '全产品';
  const p0 = m.p0;
  const lines = [
    `产品 ${dash(m.productId)}  范围: ${scope}  共 ${m.total} 条用例`,
    '',
    `★ P0（最优先）  共 ${p0.total} 条`,
    `    可用率 ${fmtRate(p0.usableRate)}（可用或已验证 ${p0.usable}/${p0.total}）    已验证率 ${fmtRate(p0.verifiedRate)}（${p0.verified}/${p0.total}）`,
    `    ${distText(p0)}`,
    '',
  ];
  const rest = [m.p1, m.p2, m.overall];
  lines.push(renderTable([['PRIORITY', 'TOTAL', 'USABLE', 'USABLE RATE', 'VERIFIED RATE', 'DISTRIBUTION'],
    ...rest.map((b) => [bucketName(b), String(b.total), String(b.usable), fmtRate(b.usableRate), fmtRate(b.verifiedRate), distText(b)])]));
  lines.push('', '指标只是参考，不接入任何审批或质量门禁；实时计算，没有历史。');
  return lines.join('\n');
}

export function renderGaps(list: UcListItem[]): string {
  if (!list.length) return empty('P0 缺口用例');
  return `P0 且状态为部分/未开始的用例，共 ${list.length} 条:\n${renderTable([['CODE', 'STATUS', 'GOAL', 'GAPS', 'REACH'],
    ...list.map((u) => [u.code, dash(u.statusLabel), u.goal, gapText(u.gaps), dash(u.reachSummary)])], { 2: wrap(36), 3: wrap(40) })}`;
}

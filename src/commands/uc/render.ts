import { ApiDate, dash, fmtDateTime, renderTable } from '../../utils/cliHelpers';

export interface Freshness { state?: string; label?: string; upToDate?: boolean; reason?: string | null }
export interface RenderRef { id?: number; sourceSha256?: string; renderedAt?: ApiDate; plantumlVersion?: string; objectFileId?: number }
export interface UcListItem {
  id: number; code: string; actorName?: string; actorDisabled?: boolean; goal: string; priority: string; channels?: string[];
  subModuleName?: string | null; functionPointCount?: number; noFunctionPoint?: boolean;
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

const empty = (what: string) => `(没有${what})`;
const wrap = (width: number) => ({ width, wrapWord: false });

export function renderList(page: UcPage): string {
  const rows = page.records ?? [];
  if (!rows.length) return empty('用例');
  const table = renderTable([['CODE', 'PRI', 'ACTOR', 'GOAL', 'CHANNELS', 'FP', 'SUB-MODULE'],
    ...rows.map((u) => [u.code, u.priority, `${dash(u.actorName)}${u.actorDisabled ? '（已停用）' : ''}`, u.goal, (u.channels ?? []).join(','),
      u.noFunctionPoint ? '未关联' : dash(u.functionPointCount), dash(u.subModuleName)])], { 3: wrap(40) });
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

import { ApiDate, DASH, dash, fmtDateTime, renderTable } from '../../utils/cliHelpers';
import { extractRecords } from '../../utils/extractRecords';

export interface DependencyVo {
  id?: number | null;
  versionId?: number | null;
  requiredTemplateId?: number | null;
  requiredTemplateName?: string | null;
  minVersion?: string | null;
  kind?: string | null;
}

export interface VariableDef {
  name?: string | null;
  label?: string | null;
  type?: string | null;
  required?: boolean | null;
  default?: unknown;
  options?: string[] | null;
}

export interface VersionVo {
  id?: number;
  templateId?: number;
  version?: string | null;
  changelog?: string | null;
  status?: string | null;
  content?: unknown;
  variables?: VariableDef[] | null;
  compatibility?: unknown;
  previousVersionId?: number | null;
  submittedAt?: ApiDate;
  publishedAt?: ApiDate;
  reviewResult?: string | null;
  reviewComment?: string | null;
  reviewedBy?: number | null;
  reviewedAt?: ApiDate;
  createdBy?: number | null;
  createdAt?: ApiDate;
  updatedAt?: ApiDate;
  dependencies?: DependencyVo[] | null;
}

/** Content can be up to 1 MB: show the head in a terminal, the whole thing is in `--json`. */
const CONTENT_LINES = 60;

/** `content` is untrusted user text (api-0091 §1): printed as text only, control characters are stripped by `emit`. */
export function renderContent(content: unknown): string[] {
  if (content === null || content === undefined) return [`内容: ${DASH}`];
  const lines = JSON.stringify(content, null, 2).split('\n');
  const shown = lines.slice(0, CONTENT_LINES);
  if (lines.length > CONTENT_LINES) shown.push(`… 共 ${lines.length} 行，已省略 ${lines.length - CONTENT_LINES} 行（完整内容用 --json）`);
  return ['内容:', ...shown];
}

export function renderVariables(variables: VariableDef[] | null | undefined): string[] {
  if (!variables?.length) return [`变量: ${DASH}`];
  const rows = [['名称', '类型', '必填', '默认值', '标签']].concat(
    variables.map((v) => [dash(v.name), dash(v.type), v.required ? '是' : '否', dash(v.default), dash(v.label)])
  );
  return [`变量 (${variables.length})`, renderTable(rows, { 3: { truncate: 30 }, 4: { truncate: 30 } })];
}

export function renderDependencies(deps: DependencyVo[] | null | undefined): string[] {
  if (!deps?.length) return [`依赖: ${DASH}`];
  const rows = [['ID', '被依赖模板', '名称', '最低版本', '类型']].concat(
    deps.map((d) => [dash(d.id), `#${dash(d.requiredTemplateId)}`, dash(d.requiredTemplateName), dash(d.minVersion), dash(d.kind)])
  );
  return [`依赖 (${deps.length})`, renderTable(rows)];
}

export function renderDependencyList(result: unknown): string {
  return renderDependencies(extractRecords<DependencyVo>(result)).join('\n');
}

function reviewLine(v: VersionVo): string[] {
  if (!v.reviewResult && !v.reviewComment) return [];
  const by = v.reviewedBy ? ` by ${v.reviewedBy}` : '';
  return [`审核:     ${dash(v.reviewResult)}${by} @ ${fmtDateTime(v.reviewedAt)}${v.reviewComment ? ` — ${v.reviewComment}` : ''}`];
}

export function renderVersionHeader(v: VersionVo): string[] {
  return [
    `版本 ${dash(v.version)}  [${dash(v.status)}]  (id ${dash(v.id)}, 模板 #${dash(v.templateId)})`,
    `时间:     提交 ${fmtDateTime(v.submittedAt)}    发布 ${fmtDateTime(v.publishedAt)}    创建 ${fmtDateTime(v.createdAt)} by ${dash(v.createdBy)}`,
    `上一版本: ${v.previousVersionId ? `#${v.previousVersionId}` : DASH}`,
    ...reviewLine(v),
    ...(v.changelog ? [`变更说明: ${v.changelog}`] : []),
  ];
}

export function renderVersion(v: VersionVo): string {
  return [
    ...renderVersionHeader(v),
    '',
    ...renderVariables(v.variables),
    '',
    ...renderDependencies(v.dependencies),
    '',
    ...renderContent(v.content),
  ].join('\n');
}

/** The list endpoint carries no content / variables / dependencies. */
export function renderVersionList(result: unknown): string {
  const records = extractRecords<VersionVo>(result);
  if (!records.length) return '没有可见的版本。';
  const rows = [['版本', '状态', '审核', '提交', '发布', '变更说明']].concat(
    records.map((v) => [
      dash(v.version), dash(v.status), dash(v.reviewResult), fmtDateTime(v.submittedAt), fmtDateTime(v.publishedAt), dash(v.changelog),
    ])
  );
  return `${renderTable(rows, { 5: { truncate: 40 } })}\n共 ${records.length} 个版本`;
}

// ── diff (DiffVo) ──

interface DiffEntry { path?: string | null; from?: string | null; to?: string | null }
interface DiffSet { added?: DiffEntry[] | null; changed?: DiffEntry[] | null; removed?: DiffEntry[] | null }
export interface DiffVo {
  from?: string | null; to?: string | null; identical?: boolean | null; truncated?: boolean | null;
  content?: DiffSet | null; variables?: DiffSet | null;
}

function diffSection(title: string, set: DiffSet | null | undefined): string[] {
  const added = set?.added ?? [];
  const changed = set?.changed ?? [];
  const removed = set?.removed ?? [];
  if (!added.length && !changed.length && !removed.length) return [`${title}: 无差异`];
  return [
    `${title}  (+${added.length} ~${changed.length} -${removed.length})`,
    ...added.map((e) => `  + ${dash(e.path)}: ${dash(e.to)}`),
    ...changed.map((e) => `  ~ ${dash(e.path)}: ${dash(e.from)} → ${dash(e.to)}`),
    ...removed.map((e) => `  - ${dash(e.path)}: ${dash(e.from)}`),
  ];
}

export function renderDiff(d: DiffVo): string {
  return [
    `版本差异 ${dash(d.from)} → ${dash(d.to)}${d.identical ? '（完全相同）' : ''}`,
    ...(d.truncated ? ['⚠ 差异过多，结果已截断（每类最多 200 条，文本最多 500 字符）'] : []),
    ...diffSection('内容', d.content),
    ...diffSection('变量', d.variables),
  ].join('\n');
}

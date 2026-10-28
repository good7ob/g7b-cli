import { ApiDate, dash, fmtDateTime, renderTable } from '../../utils/cliHelpers';

export interface UiApp { id: number; orgId?: number; name?: string; platform?: string; description?: string | null; sortOrder?: number | null }
export interface UiScreen {
  id: number; appId?: number; screenCode?: string | null; name?: string; routePath?: string | null;
  category?: string | null; status?: string | null; sortOrder?: number | null; parentScreenId?: number | null;
}
export interface UiVersion {
  id: number; screenId?: number; versionType?: string; label?: string; description?: string | null;
  isActive?: boolean | null; createdAt?: ApiDate;
}
export interface UiScreenshot { id: number; versionId?: number; fileUrl?: string; thumbnailUrl?: string | null; caption?: string | null; sortOrder?: number | null }
export interface UiFlow { id: number; appId?: number; name?: string; description?: string | null; sortOrder?: number | null }
export interface UiFlowNode {
  id: number; flowId?: number; fromScreenId?: number | null; toScreenId?: number | null;
  triggerDesc?: string | null; conditionDesc?: string | null; sortOrder?: number | null;
}

const wrap = (width: number) => ({ width, wrapWord: false });
const empty = (what: string) => `(没有${what})`;

export function renderApps(list: UiApp[]): string {
  if (!list.length) return empty('应用');
  return renderTable([['ID', 'NAME', 'PLATFORM', 'SORT', 'DESCRIPTION'],
    ...list.map((a) => [String(a.id), dash(a.name), dash(a.platform), dash(a.sortOrder), dash(a.description)])], { 4: wrap(40) });
}

export function renderScreens(list: UiScreen[]): string {
  if (!list.length) return empty('页面');
  return renderTable([['ID', 'CODE', 'NAME', 'PARENT', 'ROUTE', 'CATEGORY', 'STATUS', 'SORT'],
    ...list.map((s) => [String(s.id), dash(s.screenCode), dash(s.name), dash(s.parentScreenId), dash(s.routePath), dash(s.category),
      dash(s.status), dash(s.sortOrder)])]);
}

export function renderVersions(list: UiVersion[]): string {
  if (!list.length) return empty('设计稿版本');
  return renderTable([['ID', 'TYPE', 'ACTIVE', 'LABEL', 'CREATED', 'DESCRIPTION'],
    ...list.map((v) => [String(v.id), dash(v.versionType), v.isActive ? '✓' : '', dash(v.label), fmtDateTime(v.createdAt), dash(v.description)])], { 5: wrap(40) });
}

export function renderScreenshots(list: UiScreenshot[]): string {
  if (!list.length) return empty('截图');
  return renderTable([['ID', 'SORT', 'CAPTION', 'URL'],
    ...list.map((s) => [String(s.id), dash(s.sortOrder), dash(s.caption), dash(s.fileUrl)])], { 3: wrap(80) });
}

export function renderFlows(list: UiFlow[]): string {
  if (!list.length) return empty('流程');
  return renderTable([['ID', 'NAME', 'SORT', 'DESCRIPTION'],
    ...list.map((f) => [String(f.id), dash(f.name), dash(f.sortOrder), dash(f.description)])], { 3: wrap(40) });
}

/** `names` (screen id -> name) turns ids into `#12 登录页`; without it only `#12`. */
export function renderNodes(list: UiFlowNode[], names?: Map<number, string>): string {
  if (!list.length) return empty('流程节点');
  const label = (id?: number | null) => (id == null ? '(入口)' : `#${id}${names?.get(id) ? ` ${names.get(id)}` : ''}`);
  return renderTable([['ID', 'FROM', '', 'TO', 'TRIGGER', 'CONDITION', 'SORT'],
    ...list.map((n) => [String(n.id), label(n.fromScreenId), '→', label(n.toScreenId), dash(n.triggerDesc), dash(n.conditionDesc), dash(n.sortOrder)])]);
}

export interface UiPreviewRow {
  preview?: { id: number; name?: string; kind?: string; screenId?: number | null; currentVersionId?: number | null; updatedAt?: ApiDate };
  thumbnailPath?: string | null;
}

export function renderPreviews(list: UiPreviewRow[]): string {
  if (!list.length) return empty('设计稿预览');
  return renderTable([['ID', 'KIND', 'SCREEN', 'NAME', 'UPDATED'],
    ...list.map(({ preview: p }) => [String(p?.id ?? '-'), dash(p?.kind), dash(p?.screenId), dash(p?.name), fmtDateTime(p?.updatedAt)])], { 3: wrap(40) });
}

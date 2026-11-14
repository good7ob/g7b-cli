/**
 * Renderers for `template setting get|set|clear` (backend `/templates/settings`, prd-0091 FP-23). Every value may be
 * null (shown as "—"); `--json` prints the response untouched.
 */

import { DASH, dash, renderTable } from '../../utils/cliHelpers';

export interface SettingInfo {
  settingId?: number; templateId?: number; templateName?: string | null; mode?: string | null;
  valid?: boolean; invalidReason?: string | null;
}

export interface EffectiveInfo {
  layer?: string | null; applied?: boolean; enforced?: boolean; mode?: string | null; templateId?: number | null;
  templateName?: string | null; version?: string | null; scopeType?: string | null; scopeId?: number | null;
  skippedEnforcements?: Array<{ layer?: string; scopeType?: string; scopeId?: number; templateId?: number; reason?: string }> | null;
}

export interface SettingItem {
  templateType?: string; modeSupported?: boolean; setting?: SettingInfo | null; readOnly?: boolean;
  readOnlyReason?: string | null;
  orgEnforced?: { templateId?: number; templateName?: string | null; version?: string | null } | null;
  effective?: EffectiveInfo | null;
}

export interface SettingsVo { scopeType?: string; scopeId?: number | null; orgId?: number | null; items?: SettingItem[] | null }

const LAYERS: Record<string, string> = {
  ORG_ENFORCE: '组织强制', CONTAINER_ENFORCE: '项目/产品强制', CONTAINER_RECOMMEND: '项目/产品推荐',
  PERSONAL: '个人', ORG_RECOMMEND: '组织推荐', NONE: '未设置',
};
const MODES: Record<string, string> = { ENFORCE: '强制', RECOMMEND: '推荐' };
const SCOPES: Record<string, string> = {
  ORGANIZATION: '组织', PROJECT: '项目', PRODUCT: '产品', USER: '个人', AI_EMPLOYEE: 'AI 员工',
};

const tpl = (id: unknown, name: unknown, version?: unknown) =>
  `#${dash(id)} ${dash(name)}${version ? ` v${version}` : ''}`;
const mode = (m: string | null | undefined) => (m ? (MODES[m] ?? m) : DASH);

function settingCell(s: SettingInfo | null | undefined): string {
  if (!s) return DASH;
  return `${tpl(s.templateId, s.templateName)}${s.valid === false ? '（已失效）' : ''}`;
}

function effectiveCell(e: EffectiveInfo | null | undefined): string {
  if (!e) return DASH;
  const layer = LAYERS[e.layer ?? ''] ?? dash(e.layer);
  return e.templateId ? `${layer}：${tpl(e.templateId, e.templateName, e.version)}` : layer;
}

function noteLines(item: SettingItem): string[] {
  const type = dash(item.templateType);
  const notes: string[] = [];
  if (item.readOnly) {
    const org = item.orgEnforced;
    notes.push(`${type}: 组织已强制，只读${org ? `（组织所选 ${tpl(org.templateId, org.templateName, org.version)}）` : ''}`);
  }
  if (item.setting?.valid === false) {
    notes.push(`${type}: 本层设置已失效，视为没设${item.setting.invalidReason ? `（${item.setting.invalidReason}）` : ''}`);
  }
  (item.effective?.skippedEnforcements ?? []).forEach((s) => notes.push(
    `${type}: 跳过了 ${LAYERS[s.layer ?? ''] ?? dash(s.layer)} #${dash(s.templateId)}${s.reason ? `（${s.reason}）` : ''}`));
  return notes;
}

export function renderSettings(vo: SettingsVo | null | undefined, empty = '该范围没有可设置的类型。'): string {
  const items = vo?.items ?? [];
  const head = `范围: ${SCOPES[vo?.scopeType ?? ''] ?? dash(vo?.scopeType)}${vo?.scopeId ? ` #${vo.scopeId}` : ''}${vo?.orgId && vo.orgId !== vo.scopeId ? `（组织 #${vo.orgId}）` : ''}`;
  if (!items.length) return `${head}\n${empty}`;
  const rows = [['类型', '本层设置', '模式', '最终生效', '生效模式']].concat(items.map((i) => [
    dash(i.templateType), settingCell(i.setting), i.modeSupported === false ? DASH : mode(i.setting?.mode),
    effectiveCell(i.effective), mode(i.effective?.mode),
  ]));
  const notes = items.flatMap(noteLines);
  return [head, renderTable(rows, { 1: { truncate: 40 }, 3: { truncate: 60 } }), ...notes.map((n) => `· ${n}`)].join('\n');
}

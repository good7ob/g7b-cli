import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { ErrorCodeMap, InputError, emit, guarded, parseId, requireOneOf } from '../../utils/cliHelpers';
import { oneOf } from './input';
import { SettingsVo, renderSettings } from './renderSetting';

/**
 * `template setting get|set|clear`: the effective template (and mode) of each layer — organization, project,
 * product, personal, AI employee — plus the resolved result (backend `/templates/settings`, prd-0091 FP-23).
 */

const BASE = '/templates/settings';

const SCOPES = ['org', 'project', 'product', 'user', 'ai-employee'] as const;
type Scope = (typeof SCOPES)[number];
const SCOPE_TYPE: Record<Scope, string> = {
  org: 'ORGANIZATION', project: 'PROJECT', product: 'PRODUCT', user: 'USER', 'ai-employee': 'AI_EMPLOYEE',
};
const SCOPE_LABEL: Record<Scope, string> = { org: '组织', project: '项目', product: '产品', user: '个人', 'ai-employee': 'AI 员工' };
const SETTING_TYPES = ['TASK', 'PRD', 'UI', 'API', 'DB', 'ARCH', 'OTHER', 'TEST', 'RELEASE'] as const;
const MODES = ['enforce', 'recommend'] as const;

export const SETTING_ERROR_CODES: ErrorCodeMap = {
  1000: '缺少必填参数（范围 id / 组织 / 模板）',
  1001: '类型、范围或模板不符（后端原因见方括号内）',
  1002: '对象不存在或不属于该组织（项目 / 产品 / AI 员工；个人产品、个人项目不支持设置）',
  1007: '组织已强制该类型：项目 / 产品不能修改（请由组织 owner/admin 在组织层调整）',
  2000: '没有权限：写入需要组织 owner/admin（个人设置只能改自己的）；读取需要是组织成员',
};

interface ScopeOpts { scope: string; id?: string; org?: string }

const withScope = (cmd: Command): Command => cmd
  .requiredOption('--scope <scope>', `Scope (${oneOf(SCOPES)})`)
  .option('--id <id>', 'Scope object id: organization / project / product / AI-employee id (not needed for user)')
  .option('--org <orgId>', 'Owning organization (required for project|product|ai-employee; for org it defaults to --id; optional for user)');

/** --scope/--id/--org -> the backend's scopeType/scopeId/orgId (ORGANIZATION takes its org from scopeId). */
export function buildScopeParams(o: ScopeOpts): Record<string, string | number> {
  const scope = requireOneOf(String(o.scope).trim().toLowerCase(), SCOPES, '--scope');
  const params: Record<string, string | number> = { scopeType: SCOPE_TYPE[scope] };
  if (scope === 'user') {
    if (o.id !== undefined) params.scopeId = parseId(o.id, '--id');
  } else {
    const id = o.id ?? (scope === 'org' ? o.org : undefined);
    if (id === undefined) throw new InputError(`--scope ${scope} 必须带 --id <${SCOPE_LABEL[scope]} id>`);
    params.scopeId = parseId(id, '--id');
  }
  if (o.org !== undefined && scope !== 'org') params.orgId = parseId(o.org, '--org');
  if (['project', 'product', 'ai-employee'].includes(scope) && params.orgId === undefined) {
    throw new InputError(`--scope ${scope} 必须带 --org <组织 id>`);
  }
  return params;
}

const typeParam = (raw: string) => requireOneOf(String(raw).trim().toUpperCase(), SETTING_TYPES, '--type');
const query = (params: Record<string, string | number>) =>
  `?${new URLSearchParams(Object.entries(params).map(([k, v]): [string, string] => [k, String(v)]))}`;

export function registerSettingCommands(tpl: Command): void {
  const setting = tpl
    .command('setting')
    .description('Effective template and mode per layer (org / project / product / user / ai-employee): view, set, clear');

  withScope(setting.command('get'))
    .description('Show each type\'s setting of a scope and the resulting effective template (layer, template, version, mode); marks org-enforced (read-only) and invalidated settings')
    .option('--type <type>', `Only this type (${oneOf(SETTING_TYPES)})`)
    .option('--json', 'Output as JSON')
    .action((o) => guarded('获取生效设置失败', SETTING_ERROR_CODES, async () => {
      const params = buildScopeParams(o);
      const type = o.type === undefined ? undefined : typeParam(o.type);
      const vo: SettingsVo = await apiClient.get(BASE, params);
      const shown = type ? { ...vo, items: (vo?.items ?? []).filter((i) => i.templateType === type) } : vo;
      emit(o.json, shown, () => renderSettings(shown, type ? `该范围没有 ${type} 类型可设置。` : undefined));
    }));

  withScope(setting.command('set'))
    .description('Set (or replace) the template of one type in a scope; --mode only for org / project / product (default: keep the existing mode, new settings are recommend)')
    .requiredOption('--type <type>', `Template type (${oneOf(SETTING_TYPES)})`)
    .requiredOption('--template <id>', 'Template id (must be usable and of that type)')
    .option('--mode <mode>', `Mode (${oneOf(MODES)}); not available for user / ai-employee`)
    .option('--json', 'Output as JSON')
    .action((o) => guarded('设置生效模板失败', SETTING_ERROR_CODES, async () => {
      const scope = buildScopeParams(o);
      const body: Record<string, unknown> = { ...scope, templateType: typeParam(o.type), templateId: parseId(o.template, '--template') };
      if (o.mode !== undefined) {
        if (scope.scopeType === 'USER' || scope.scopeType === 'AI_EMPLOYEE') throw new InputError('个人与 AI 员工没有模式，不能带 --mode');
        body.mode = requireOneOf(String(o.mode).trim().toLowerCase(), MODES, '--mode').toUpperCase();
      }
      const vo: SettingsVo = await apiClient.put(BASE, body);
      emit(o.json, vo, () => `✓ 已设置 ${body.templateType} 的生效模板\n${renderSettings(vo)}`);
    }));

  withScope(setting.command('clear'))
    .description('Clear the setting of one type in a scope (idempotent)')
    .requiredOption('--type <type>', `Template type (${oneOf(SETTING_TYPES)})`)
    .option('--json', 'Output as JSON')
    .action((o) => guarded('清除生效设置失败', SETTING_ERROR_CODES, async () => {
      const type = typeParam(o.type);
      const vo: SettingsVo = await apiClient.delete(`${BASE}${query({ ...buildScopeParams(o), templateType: type })}`);
      emit(o.json, vo, () => `✓ 已清除 ${type} 的设置\n${renderSettings(vo)}`);
    }));
}

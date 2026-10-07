import { ApiDate, DASH, dash, fmtDateTime, renderTable } from '../../utils/cliHelpers';

export interface SecretVo {
  kind?: string | null;
  masked?: string | null;
  ref?: string | null;
}

export interface ItemVo {
  id: number;
  ownerType?: string | null;
  ownerId?: number | null;
  type?: string | null;
  env?: string | null;
  name?: string | null;
  description?: string | null;
  fields?: Record<string, string> | null;
  secrets?: Record<string, SecretVo> | null;
  securityLevel?: string | null;
  expiresAt?: string | null;
  expired?: boolean | null;
  canEdit?: boolean | null;
  canReveal?: boolean | null;
  updatedAt?: ApiDate;
}

export interface EffectiveEntry {
  item: ItemVo;
  sourceLayer?: string | null;
  sourceOwnerId?: number | null;
  sourceOwnerName?: string | null;
  readOnly?: boolean | null;
  overridesUpper?: boolean | null;
  overrides?: ItemVo[] | null;
}

export interface EffectiveVo {
  ownerType?: string | null;
  ownerId?: number | null;
  entries?: EffectiveEntry[] | null;
  apps?: Array<{ id: number; name?: string | null; repoUrl?: string | null; defaultBranch?: string | null; deployTarget?: string | null }> | null;
}

export interface ClearanceVo {
  id: number;
  granteeType?: string | null;
  granteeId?: number | null;
  granteeName?: string | null;
  level?: string | null;
  scopeType?: string | null;
  scopeId?: number | null;
  createdAt?: ApiDate;
}

/** A sensitive field is never printed in clear here: a fixed mask, or the reference text. */
function secretText(s: SecretVo): string {
  return s.kind === 'REF' ? `→ ${dash(s.ref)}` : dash(s.masked ?? '******');
}

/** `host=db.local, port=5432, password=******` — plain fields first, then masked secrets. */
export function itemContent(item: ItemVo): string {
  const plain = Object.entries(item.fields ?? {}).map(([k, v]) => `${k}=${v}`);
  const secret = Object.entries(item.secrets ?? {}).map(([k, v]) => `${k}=${secretText(v)}`);
  return [...plain, ...secret].join(', ') || DASH;
}

const flag = (item: ItemVo) => (item.expired ? ' (已过期)' : '');

export function renderEffective(vo: EffectiveVo): string {
  const entries = vo.entries ?? [];
  const head = `${dash(vo.ownerType)}#${dash(vo.ownerId)} 的开发信息（敏感值已掩码）`;
  if (!entries.length) return `${head}\n没有可见的条目。`;
  const rows = [['ID', '类型', '环境', '名称', '级别', '来源', '内容']].concat(
    entries.map((e) => [
      String(e.item.id), dash(e.item.type), dash(e.item.env), dash(e.item.name) + flag(e.item), dash(e.item.securityLevel),
      `${dash(e.sourceLayer)}${e.sourceOwnerName ? ` ${e.sourceOwnerName}` : ''}${e.overridesUpper ? ' ⤴覆盖上层' : ''}`,
      itemContent(e.item),
    ])
  );
  const lines = [head, renderTable(rows, { 3: { truncate: 28 }, 6: { truncate: 80 } })];
  const apps = vo.apps ?? [];
  if (apps.length) {
    lines.push('', '应用:', ...apps.map((a) => `  #${a.id} ${dash(a.name)}  ${dash(a.repoUrl)}  ${dash(a.defaultBranch)}  ${dash(a.deployTarget)}`));
  }
  lines.push('', '查看明文: good7ob dev-info get --<对象> <id> --item <条目ID> --reveal <字段>');
  return lines.join('\n');
}

export function renderItemList(items: ItemVo[]): string {
  if (!items.length) return '该对象下没有条目。';
  const rows = [['ID', '类型', '环境', '名称', '级别', '内容']].concat(
    items.map((i) => [String(i.id), dash(i.type), dash(i.env), dash(i.name) + flag(i), dash(i.securityLevel), itemContent(i)])
  );
  return renderTable(rows, { 3: { truncate: 28 }, 5: { truncate: 80 } });
}

export function renderItemDetail(i: ItemVo): string {
  const lines = [
    `条目 #${i.id}  ${dash(i.name)}${flag(i)}`,
    '─'.repeat(60),
    `类型: ${dash(i.type)}    环境: ${dash(i.env)}    安全级别: ${dash(i.securityLevel)}    挂载: ${dash(i.ownerType)}#${dash(i.ownerId)}`,
    `到期: ${dash(i.expiresAt)}    我能编辑: ${i.canEdit ? '是' : '否'}    我能看明文: ${i.canReveal ? '是' : '否'}    更新: ${fmtDateTime(i.updatedAt)}`,
    `内容: ${itemContent(i)}`,
  ];
  if (i.description) lines.push('', i.description);
  return lines.join('\n');
}

export function renderClearances(list: ClearanceVo[]): string {
  if (!list.length) return '没有访问许可。';
  const rows = [['ID', '对象', '名称', '级别', '范围', '授予时间']].concat(
    list.map((c) => [
      String(c.id), `${dash(c.granteeType)}:${dash(c.granteeId)}`, dash(c.granteeName), dash(c.level),
      `${dash(c.scopeType)}${c.scopeId ? `#${c.scopeId}` : ''}`, fmtDateTime(c.createdAt),
    ])
  );
  return renderTable(rows);
}

/** CLI-boundary validation for template packages (TemplatePackageService: <=30 items, version constraints, free only). */

import { InputError, checkMaxLength, parseId, requireText } from '../../utils/cliHelpers';
import { MAX_DESCRIPTION, MAX_NAME, VISIBILITIES, pageParams, upperOneOf } from './input';

export const MAX_ITEMS = 30;
const CONSTRAINT = /^(\*|(\^|~|>=)?[0-9]{1,6}\.[0-9]{1,6}\.[0-9]{1,6})$/;

type Body = Record<string, unknown>;

/** `<templateId>[:<constraint>]` where constraint is `*` | x.y.z | ^x.y.z | ~x.y.z | >=x.y.z (default `*`). */
export function parseItem(raw: string): { templateId: number; versionConstraint?: string } {
  const at = raw.indexOf(':');
  const templateId = parseId(at < 0 ? raw : raw.slice(0, at), '--item 的 templateId');
  if (at < 0) return { templateId };
  const constraint = raw.slice(at + 1).trim();
  if (!CONSTRAINT.test(constraint)) {
    throw new InputError(`--item 的版本约束必须是 * / x.y.z / ^x.y.z / ~x.y.z / >=x.y.z，收到: ${raw}`);
  }
  return { templateId, versionConstraint: constraint };
}

export function parseItems(raw: string[]): Body[] {
  if (raw.length > MAX_ITEMS) throw new InputError(`--item 最多 ${MAX_ITEMS} 个，当前 ${raw.length} 个`);
  const items = raw.map(parseItem);
  const ids = items.map((i) => i.templateId);
  if (new Set(ids).size !== ids.length) throw new InputError('--item 的 templateId 不能重复');
  return items;
}

export interface PackageFlags {
  name?: string; description?: string; visibility?: string; org?: string; item?: string[]; clearItems?: boolean;
}

function applyFields(body: Body, o: PackageFlags): void {
  if (o.description !== undefined) body.description = checkMaxLength(o.description, MAX_DESCRIPTION, '--description');
  if (o.visibility !== undefined) body.visibility = upperOneOf(o.visibility, VISIBILITIES, '--visibility');
  if (o.item?.length && o.clearItems) throw new InputError('--item 与 --clear-items 不能同时使用');
  if (o.item?.length) body.items = parseItems(o.item);
  else if (o.clearItems) body.items = [];
}

export function buildPackageCreateBody(o: PackageFlags): Body {
  const body: Body = { name: requireText(o.name, MAX_NAME, '--name').trim() };
  applyFields(body, o);
  if (o.org !== undefined) body.orgId = parseId(o.org, '--org');
  if (body.visibility === 'ORGANIZATION' && body.orgId === undefined) {
    throw new InputError('--visibility ORGANIZATION 只适用于组织模板包：请同时指定 --org <orgId>');
  }
  return body;
}

/** Omitted flag = field unchanged; `--item` replaces all items. */
export function buildPackageUpdateBody(o: PackageFlags): Body {
  const body: Body = {};
  if (o.name !== undefined) body.name = requireText(o.name, MAX_NAME, '--name').trim();
  applyFields(body, o);
  if (Object.keys(body).length === 0) {
    throw new InputError('没有要修改的字段：至少指定 --name / --description / --visibility / --item / --clear-items 之一');
  }
  return body;
}

/** `package list`: library (default), `--mine`, or `--org <id>`. */
export function buildPackageListRequest(o: {
  keyword?: string; mine?: boolean; org?: string; page?: string; pageSize?: string;
}): { url: string; params: Record<string, string | number> } {
  if (o.mine && o.org !== undefined) throw new InputError('--mine 与 --org 不能同时使用');
  if (o.keyword !== undefined && (o.mine || o.org !== undefined)) {
    throw new InputError('--keyword 只适用于模板包库（不带 --mine / --org）');
  }
  const params: Record<string, string | number> = pageParams(o);
  if (o.mine) return { url: '/templates/packages/mine', params };
  if (o.org !== undefined) return { url: `/templates/packages/org/${parseId(o.org, '--org')}`, params };
  if (o.keyword?.trim()) params.keyword = o.keyword.trim();
  return { url: '/templates/packages', params };
}

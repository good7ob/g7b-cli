/**
 * CLI-boundary validation for template versions, dependencies, reviews and admin decisions.
 * Limits mirror TemplateVersionService / TemplateDependencyService / TemplateReviewService / TemplateModerationService.
 */

import { InputError, checkMaxLength, parseId, parseIntInRange, requireOneOf, requireText } from '../../utils/cliHelpers';
import {
  checkCompatibility, checkContent, checkVariables, loadJson, parseJsonText, readJsonFile,
} from './jsonInput';

const SEMVER = /^[0-9]{1,6}\.[0-9]{1,6}\.[0-9]{1,6}$/;
export const MAX_CHANGELOG = 5000;
export const MAX_COMMENT = 1000;
export const MAX_DEPENDENCIES = 20;
export const DEPENDENCY_KINDS = ['requires', 'optional'] as const;

type Body = Record<string, unknown>;

/** `x.y.z`, each part 1-6 digits (the server compares numerically: 1.10.0 > 1.9.0). */
export function requireSemver(raw: string | undefined, label: string): string {
  const text = (raw ?? '').trim();
  if (!SEMVER.test(text)) throw new InputError(`${label} 必须是 x.y.z 格式的版本号（如 1.0.0），收到: ${raw === undefined ? '(空)' : raw}`);
  return text;
}

export interface PayloadFlags {
  changelog?: string; content?: string; contentFile?: string; variablesFile?: string; compatibilityFile?: string;
}

export interface Payload {
  changelog?: string; content?: Record<string, unknown>; variables?: unknown[]; compatibility?: Record<string, unknown>;
}

/** Load + guard every JSON piece the user supplied (nothing is sent before all of them pass). */
export function loadPayload(o: PayloadFlags): Payload {
  const content = loadJson({ file: o.contentFile, inline: o.content }, '--content-file', '--content', 'content');
  const variables = loadJson({ file: o.variablesFile }, '--variables-file', '--variables-file', 'variables');
  const compatibility = loadJson({ file: o.compatibilityFile }, '--compatibility-file', '--compatibility-file', 'compatibility');
  const payload: Payload = {};
  if (o.changelog !== undefined) payload.changelog = checkMaxLength(o.changelog, MAX_CHANGELOG, '--changelog');
  if (content !== undefined) payload.content = checkContent(content);
  if (variables !== undefined) payload.variables = checkVariables(variables);
  if (compatibility !== undefined) payload.compatibility = checkCompatibility(compatibility);
  return payload;
}

export function buildVersionAddBody(o: PayloadFlags & { version?: string }): Body {
  const version = requireSemver(o.version, '--version');
  const payload = loadPayload(o);
  if (payload.content === undefined) throw new InputError('缺少内容：用 --content-file <file.json> 或 --content \'<json>\' 提供 content');
  return { version, ...payload };
}

/** Omitted flag = field unchanged; content and variables are re-validated together by the server. */
export function buildVersionUpdateBody(o: PayloadFlags): Body {
  const payload = loadPayload(o);
  if (Object.keys(payload).length === 0) {
    throw new InputError('没有要修改的字段：至少指定 --changelog / --content-file / --content / --variables-file / --compatibility-file 之一');
  }
  return { ...payload };
}

/** deps.json: an array, or `{ "dependencies": [...] }`; each `{requiredTemplateId, minVersion?, kind?}`. */
export function loadDependencies(file: string): DependencyBody[] {
  const parsed = parseJsonText(readJsonFile(file, '--file'), 'dependencies');
  const list = Array.isArray(parsed) ? parsed : (parsed as { dependencies?: unknown } | null)?.dependencies;
  if (!Array.isArray(list)) throw new InputError('dependencies: 文件必须是数组，或形如 {"dependencies": [...]} 的对象');
  if (list.length > MAX_DEPENDENCIES) throw new InputError(`dependencies: 最多 ${MAX_DEPENDENCIES} 个，当前 ${list.length} 个`);
  const entries = list.map((item, i) => parseDependency(item, `dependencies[${i}]`));
  const ids = entries.map((e) => e.requiredTemplateId);
  if (new Set(ids).size !== ids.length) throw new InputError('dependencies: requiredTemplateId 不能重复');
  return entries;
}

function parseDependency(item: unknown, at: string): DependencyBody {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) throw new InputError(`${at}: 必须是对象`);
  const raw = item as Record<string, unknown>;
  const extra = Object.keys(raw).filter((k) => !['requiredTemplateId', 'minVersion', 'kind'].includes(k));
  if (extra.length) throw new InputError(`${at}: 不支持的字段 ${extra.join(', ')}（可用: requiredTemplateId, minVersion, kind）`);
  const text = (v: unknown) => (v === undefined || v === null ? undefined : String(v));
  return buildDependency(
    { template: text(raw.requiredTemplateId), minVersion: text(raw.minVersion), kind: text(raw.kind) },
    { template: `${at}.requiredTemplateId`, minVersion: `${at}.minVersion`, kind: `${at}.kind` },
  );
}

export interface DependencyBody extends Body {
  requiredTemplateId: number;
}

const FLAG_LABELS = { template: '--template', minVersion: '--min-version', kind: '--kind' };

export function buildDependency(
  o: { template?: string; minVersion?: string; kind?: string },
  labels = FLAG_LABELS,
): DependencyBody {
  const dep: DependencyBody = { requiredTemplateId: parseId(o.template, labels.template) };
  if (o.minVersion !== undefined) dep.minVersion = requireSemver(o.minVersion, labels.minVersion);
  if (o.kind !== undefined) dep.kind = requireOneOf(o.kind.trim().toLowerCase(), DEPENDENCY_KINDS, labels.kind);
  return dep;
}

export function buildReviewBody(o: { rating?: string; comment?: string }): Body {
  const body: Body = { rating: parseIntInRange(o.rating ?? '', '--rating', 1, 5) };
  if (o.comment !== undefined) body.comment = checkMaxLength(o.comment, MAX_COMMENT, '--comment');
  return body;
}

/** Admin decision note: `required` for reject / suspend, optional (may be omitted) for approve / unsuspend. */
export function buildModerationBody(raw: string | undefined, flag: string, required: boolean): Body {
  if (required) return { comment: requireText(raw, MAX_COMMENT, flag) };
  return raw === undefined ? {} : { comment: checkMaxLength(raw, MAX_COMMENT, flag) };
}

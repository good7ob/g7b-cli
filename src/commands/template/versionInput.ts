/**
 * CLI-boundary validation for template versions, reviews and admin decisions.
 * Limits mirror TemplateVersionService / TemplateReviewService / TemplateModerationService.
 */

import { InputError, checkMaxLength, parseIntInRange, requireText } from '../../utils/cliHelpers';
import {
  checkCompatibility, checkContent, checkVariables, loadJson,
} from './jsonInput';

const SEMVER = /^[0-9]{1,6}\.[0-9]{1,6}\.[0-9]{1,6}$/;
export const MAX_CHANGELOG = 5000;
export const MAX_COMMENT = 1000;

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

/**
 * CLI-boundary validation for `idea generate` / `idea correction` (IdeaSolutionGenerateDto), plus the
 * AI-specific error codes and the long client timeout shared by every command that calls the model.
 */

import { ErrorCodeMap, parseIntInRange, requireText } from '../../utils/cliHelpers';
import { IDEA_ERROR_CODES } from './input';

export const MIN_COUNT = 2;
export const MAX_COUNT = 4;
export const MAX_HINTS = 1000;
/** Model calls run synchronously server side; the ApiClient default (30 s) would cut them off. */
export const AI_TIMEOUT_MS = 180_000;

/** A2 error codes (api-0088 §4): a failed AI call writes nothing and charges no tokens. */
export const AI_ERROR_CODES: ErrorCodeMap = {
  7101: 'AI 模型调用失败（网络或服务错误），未写入任何数据、未扣 token，稍后重试',
  7102: 'AI 模型调用超时，未写入任何数据、未扣 token，稍后重试',
  7103: 'AI 输出无法解析或字段不合法（详见服务端信息），未写入任何数据、未扣 token；可重试或调整 --hints',
  7104: '本月 API 配额已用完（非 BYOK），请升级套餐或等待下月重置',
  7105: 'Token 余额不足（非 BYOK，需 ≥15000），请先充值',
};

export const GENERATE_ERROR_CODES: ErrorCodeMap = {
  ...IDEA_ERROR_CODES,
  ...AI_ERROR_CODES,
  1007: '当前状态不允许该操作：只有 draft / evaluating 的 Idea 才能生成方案',
};

/** Only the flags that were given are sent; the backend defaults count to 3. */
export function buildGenerateBody(o: { count?: string; hints?: string }): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (o.count !== undefined) body.count = parseIntInRange(o.count, '--count', MIN_COUNT, MAX_COUNT);
  if (o.hints !== undefined) body.hints = requireText(o.hints, MAX_HINTS, '--hints');
  return body;
}

/** The server may still finish (and bill) a call the client gave up on — warn before a blind retry. */
export function withTimeoutHint(error: unknown, checkCommand: string): unknown {
  const message = error instanceof Error ? error.message : String(error);
  return /timeout/i.test(message)
    ? new Error(`${message}（客户端等待超时，服务端可能仍在处理并已计费 —— 请先用 ${checkCommand} 核对，不要盲目重试）`)
    : error;
}

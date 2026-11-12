/**
 * 客户端脱敏（api-0189 §1 R1～R7）：与服务端、抽取脚本同一份清单，是「客户端先脱敏、服务端再脱敏」的前一道。
 * 规则只替换，不删字段；重复应用结果不变。
 */

const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/AKIA[0-9A-Z]{16}/g, '[AWS_KEY]'], // R1
  [/\bsk-[A-Za-z0-9_-]{20,}/g, '[API_KEY]'], // R2
  [/bearer\s+[A-Za-z0-9._~+/=-]{20,}/gi, 'Bearer [TOKEN]'], // R3
  [/(password|passwd|secret|token)(\s*[=:]\s*)\S+/gi, '$1$2[REDACTED]'], // R4
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[JWT]'], // R5
  [/(\/Users\/|\/home\/)[^/\s]+\//g, '$1[USER]/'], // R6 macOS / Linux
  [/([A-Za-z]:\\Users\\)[^\\\s]+\\/g, '$1[USER]\\'], // R6 Windows
  // R7 路径的短横线编码（如 Claude Code 项目目录名 -Users-alice-Documents-x）。
  // 已知限制：用户名本身含短横线（如 mary-ann）时只替换到第一个短横线前，后半段会留下。
  [/(-Users-)[^-/\s]+/g, '$1[USER]'],
  [/(-home-)[^-/\s]+/g, '$1[USER]'],
];

export function redact(text: string): string {
  return RULES.reduce((s, [rx, rep]) => s.replace(rx, rep), text);
}

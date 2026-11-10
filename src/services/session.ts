/**
 * Session id of the agent window this CLI runs in (task #2761).
 * Order: `--session` (per command, handled by the caller) > G7B_SESSION_ID > CLAUDE_CODE_SESSION_ID
 * (Claude Code sets the last one in every Bash environment).
 */

export const SESSION_ENV = 'G7B_SESSION_ID';
export const CLAUDE_SESSION_ENV = 'CLAUDE_CODE_SESSION_ID';
/** Same shape the backend accepts (ExecIdentity.SESSION_SHAPE); anything else is a 1001 there. */
export const SESSION_SHAPE = /^[A-Za-z0-9_-]{1,128}$/;
/** Request header carrying the first SESSION_HEADER_LEN chars of the session id (the full id never goes on the wire). */
export const SESSION_HEADER = 'X-G7B-Session';
export const SESSION_HEADER_LEN = 10;

/** The first non-blank of G7B_SESSION_ID / CLAUDE_CODE_SESSION_ID, trimmed (not shape-checked). */
export function envSessionId(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return [env[SESSION_ENV], env[CLAUDE_SESSION_ENV]].map((v) => (v ?? '').trim()).find(Boolean);
}

/** Header value for every API call, or undefined when there is no (valid) environment session id. */
export function sessionHeaderValue(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const id = envSessionId(env);
  return id && SESSION_SHAPE.test(id) ? id.slice(0, SESSION_HEADER_LEN) : undefined;
}

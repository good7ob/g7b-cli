/**
 * `agent.*` settings, stored as a nested `agent` object in ~/.good7ob/config.json.
 */

import { validateCommandTemplate } from './forward';

export interface AgentConfig {
  intervalSeconds: number;
  expectedMinutes: number;
  graceMinutes: number;
  projectId?: number;
  forward: { url?: string; secret?: string; command?: string };
}

export const AGENT_DEFAULTS = { intervalSeconds: 15, expectedMinutes: 60, graceMinutes: 30 };

const NUMERIC_KEYS = ['intervalSeconds', 'expectedMinutes', 'graceMinutes', 'projectId'] as const;
const FORWARD_KEYS = ['url', 'secret', 'command'] as const;
export const AGENT_KEYS = [...NUMERIC_KEYS, ...FORWARD_KEYS.map((k) => `forward.${k}`)];

function positive(value: unknown, label: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${label} 必须是正数，收到: ${value}`);
  return n;
}

/** Defaults applied, numbers and the command template validated. Throws on bad values. */
export function resolveAgentConfig(raw: any = {}): AgentConfig {
  const forward = { ...(raw?.forward || {}) };
  if (forward.command) validateCommandTemplate(forward.command);
  return {
    intervalSeconds: positive(raw?.intervalSeconds ?? AGENT_DEFAULTS.intervalSeconds, 'agent.intervalSeconds'),
    expectedMinutes: positive(raw?.expectedMinutes ?? AGENT_DEFAULTS.expectedMinutes, 'agent.expectedMinutes'),
    graceMinutes: positive(raw?.graceMinutes ?? AGENT_DEFAULTS.graceMinutes, 'agent.graceMinutes'),
    projectId: raw?.projectId != null ? positive(raw.projectId, 'agent.projectId') : undefined,
    forward,
  };
}

/** listen needs exactly one forward target. */
export function requireForward(cfg: AgentConfig): void {
  const { url, secret, command } = cfg.forward;
  if (url && command) throw new Error('agent.forward.url 与 agent.forward.command 只能配置一个');
  if (!url && !command) {
    throw new Error(
      '未配置转交方式：good7ob config set agent.forward.url <url>（并设 agent.forward.secret）或 good7ob config set agent.forward.command "<命令模板>"'
    );
  }
  if (url && !secret) throw new Error('配置了 agent.forward.url 时必须同时配置 agent.forward.secret');
}

/** Returns a new raw `agent` object with `key` (without the `agent.` prefix) set; '' removes it. */
export function withAgentValue(raw: any, key: string, value: string): any {
  if (!AGENT_KEYS.includes(key)) {
    throw new Error(`Unsupported config key: agent.${key}（可用: ${AGENT_KEYS.map((k) => `agent.${k}`).join(', ')}）`);
  }
  const base = raw || {};
  if (key.startsWith('forward.')) {
    const field = key.slice('forward.'.length);
    const forward = { ...(base.forward || {}), [field]: value || undefined };
    const next = { ...base, forward };
    resolveAgentConfig(next);
    return next;
  }
  const next = { ...base, [key]: value === '' ? undefined : positive(value, `agent.${key}`) };
  resolveAgentConfig(next);
  return next;
}

export function getAgentValue(raw: any, key: string): unknown {
  if (!AGENT_KEYS.includes(key)) throw new Error(`Unsupported config key: agent.${key}`);
  return key.startsWith('forward.') ? raw?.forward?.[key.slice('forward.'.length)] : raw?.[key];
}

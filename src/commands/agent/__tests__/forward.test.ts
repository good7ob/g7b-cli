import { afterEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { forwardCommand, forwardWebhook, renderCommand, sign, validateCommandTemplate } from '../forward';
import { resolveAgentConfig, requireForward, withAgentValue } from '../config';

const task = { id: 42, taskNo: 'T42', name: 'a; rm -rf /', projectId: 3, claimedAtMs: 1700000000123 };

afterEach(() => vi.restoreAllMocks());

describe('sign', () => {
  it('is hex HMAC-SHA256 of "<timestamp>.<body>"', () => {
    const body = '{"task_id":42,"task_no":"T42","event":"claimed"}';
    expect(sign('shh', '1700000000', body)).toBe('74af3f44e9d6ef86be45cd05fb82aa1f109e66df88c9f46bde376370fdb39743');
  });
});

describe('command template', () => {
  it('substitutes {taskId} and {taskNo}', () => {
    expect(renderCommand('hermes chat -q "处理 good7ob 任务 {taskId} ({taskNo})"', task)).toBe(
      'hermes chat -q "处理 good7ob 任务 42 (T42)"'
    );
  });

  it('rejects any other placeholder', () => {
    expect(() => validateCommandTemplate('claude -p "{name}"')).toThrow(/\{name\}/);
    expect(() => resolveAgentConfig({ forward: { command: 'x {projectId}' } })).toThrow(/占位符/);
    expect(() => withAgentValue({}, 'forward.command', 'x {name}')).toThrow(/占位符/);
  });

  it('refuses non-id characters in substituted values', () => {
    expect(() => renderCommand('run {taskNo}', { id: 1, taskNo: 'x;rm' })).toThrow(/非法字符/);
  });
});

describe('forwardWebhook', () => {
  it('posts the signed body with the agreed headers', async () => {
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ status: 202 } as never);
    await forwardWebhook('http://127.0.0.1:8644/webhooks/good7ob-task', 'shh', task, 1700000000999);
    const [url, body, conf] = post.mock.calls[0] as any[];
    expect(url).toBe('http://127.0.0.1:8644/webhooks/good7ob-task');
    expect(JSON.parse(body)).toEqual({ task_id: 42, task_no: 'T42', name: task.name, project_id: 3, event: 'claimed' });
    expect(conf.headers['X-Webhook-Timestamp']).toBe('1700000000');
    expect(conf.headers['X-Webhook-Signature-V2']).toBe(sign('shh', '1700000000', body));
    expect(conf.headers['X-Request-ID']).toBe('good7ob-task-42-1700000000123');
  });

  it('non-2xx is a failure', async () => {
    vi.spyOn(axios, 'post').mockResolvedValue({ status: 500 } as never);
    await expect(forwardWebhook('http://x', 's', task)).rejects.toThrow(/HTTP 500/);
  });
});

describe('forwardCommand', () => {
  it('fails when the command exits non-zero within the watch window', async () => {
    await expect(forwardCommand('exit 3', task, 1000)).rejects.toThrow(/code=3/);
  });

  it('succeeds when the command exits 0 or keeps running', async () => {
    await expect(forwardCommand('true {taskId}', task, 1000)).resolves.toBeUndefined();
    await expect(forwardCommand('sleep 1', task, 100)).resolves.toBeUndefined();
  });
});

describe('agent config', () => {
  it('applies defaults and requires exactly one forward target', () => {
    const cfg = resolveAgentConfig(undefined);
    expect(cfg).toMatchObject({ intervalSeconds: 15, expectedMinutes: 60, graceMinutes: 30 });
    expect(() => requireForward(cfg)).toThrow(/未配置转交方式/);
    expect(() => requireForward(resolveAgentConfig({ forward: { url: 'http://x' } }))).toThrow(/secret/);
    expect(() => requireForward(resolveAgentConfig({ forward: { url: 'http://x', secret: 's', command: 'c' } }))).toThrow(
      /只能配置一个/
    );
    expect(withAgentValue({}, 'graceMinutes', '45')).toEqual({ graceMinutes: 45 });
    expect(() => withAgentValue({}, 'graceMinutes', 'abc')).toThrow(/正数/);
  });
});

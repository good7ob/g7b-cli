import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../../../services/ApiClient';
import { registerIdeaCommands } from '../index';
import { bizError, noHttpCalls, ok, runCli } from '../../../utils/__tests__/cliHarness';

const idea = (args: string[], response = ok(null)) => runCli(registerIdeaCommands, ['idea', ...args], response);

beforeEach(() => {
  delete process.env.GOOD7OB_PRODUCT_ID;
});
afterEach(() => vi.restoreAllMocks());

async function expectRejected(args: string[], needle: string) {
  const r = await idea(args);
  expect(r.exitCode).toBe(1);
  expect(r.stderr).toContain('参数错误');
  expect(r.stderr).toContain(needle);
  expect(noHttpCalls(r)).toBe(true);
}

const factor = (f: number, n: number) => ({ factor: f, sampleSize: n, insufficientHistory: n < 3 });
const generated = {
  solutions: [
    { id: 41, name: '方案 A', estimationSource: 'ai', totalEffortDays: 23, effortDaysBackend: 8, estimatedCost: 30000, cycleWeeks: 4, confidence: 'medium', isSelected: false },
    { id: 42, name: '方案 B', estimationSource: 'ai', totalEffortDays: null, estimatedCost: null, cycleWeeks: null },
  ],
  correction: { effort: factor(1.3, 3), cycle: factor(1, 1), cost: factor(1, 0) },
  model: 'claude-sonnet-4', tokensUsed: 4321, estimationSource: 'ai',
};

describe('idea generate', () => {
  it('posts an empty body by default, with a long client timeout', async () => {
    const r = await idea(['generate', '21'], ok(generated));
    expect(r.http.post).toHaveBeenCalledWith('/forge/ideas/21/solutions/generate', {}, { timeout: 180_000 });
    expect(r.exitCode).toBeUndefined();
  });

  it('sends count and hints only when given', async () => {
    const r = await idea(['generate', '21', '--count', '4', '--hints', '面向中小企业'], ok(generated));
    expect(r.http.post).toHaveBeenCalledWith('/forge/ideas/21/solutions/generate', { count: 4, hints: '面向中小企业' }, { timeout: 180_000 });
  });

  it('renders the AI badge, an estimate warning, "—" for missing numbers, correction factors and tokens', async () => {
    const r = await idea(['generate', '21'], ok(generated));
    expect(r.stdout).toContain('已为 Idea #21 生成 2 个候选方案 [AI 估算]');
    expect(r.stdout).toContain('claude-sonnet-4');
    expect(r.stdout).toContain('4321');
    expect(r.stdout).toContain('AI 估算');
    expect(r.stdout).toContain('人工核对');
    expect(r.stdout).toContain('#41 方案 A');
    expect(r.stdout).toContain('#42 方案 B');
    expect(r.stdout).toContain('[AI 估算]');
    expect(r.stdout).toContain('—');
    expect(r.stdout).toContain('1.3');
    expect(r.stdout).toContain('已按历史偏差修正');
    expect(r.stdout).toContain('历史样本不足');
  });

  it('renders a response without solutions / correction as "—" instead of crashing', async () => {
    const r = await idea(['generate', '21'], ok({ solutions: [], model: null, tokensUsed: null }));
    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toContain('生成 0 个');
    expect(r.stdout).toContain('—');
  });

  it('--json prints the raw response', async () => {
    const r = await idea(['generate', '21', '--json'], ok(generated));
    expect(JSON.parse(r.stdout)).toEqual(generated);
  });

  it.each([
    [['--count', '1'], '--count'],
    [['--count', '5'], '--count'],
    [['--count', '3.5'], '--count'],
    [['--count', 'x'], '--count'],
    [['--hints', '   '], '--hints'],
    [['--hints', 'x'.repeat(1001)], '--hints'],
  ])('rejects %j before any HTTP call', async (extra, needle) => {
    await expectRejected(['generate', '21', ...extra], needle);
  });

  it('accepts count 2 and 4 and hints of exactly 1000 chars', async () => {
    for (const args of [['--count', '2'], ['--count', '4'], ['--hints', 'x'.repeat(1000)]]) {
      const r = await idea(['generate', '21', ...args], ok(generated));
      expect(r.exitCode).toBeUndefined();
    }
  });

  it('rejects a bad ideaId', async () => {
    await expectRejected(['generate', 'abc'], 'ideaId');
    await expectRejected(['generate', '0'], 'ideaId');
  });

  it.each([
    [7101, '模型调用失败'],
    [7102, '调用超时'],
    [7103, '无法解析'],
    [7104, '配额已用完'],
    [7105, 'Token 余额不足'],
    [1007, 'draft / evaluating'],
    [1002, '不存在'],
    [2000, '无权访问'],
  ])('maps code %i and keeps the server message', async (code, needle) => {
    const r = await idea(['generate', '21'], bizError(code, '第 2 个方案的 cycleWeeks 越界'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('AI 生成方案失败');
    expect(r.stderr).toContain(needle);
    expect(r.stderr).toContain(`${code}`);
    expect(r.stderr).toContain('第 2 个方案的 cycleWeeks 越界');
  });

  it('a client timeout warns that the server may still be billing and not to retry blindly', async () => {
    const http = apiClient['instance'];
    vi.spyOn(http, 'post').mockRejectedValue(new Error('timeout of 180000ms exceeded'));
    const err: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void err.push(a.join(' ')));
    vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    const program = new Command();
    registerIdeaCommands(program);
    await program.parseAsync(['node', 'good7ob', 'idea', 'generate', '21']).catch(() => undefined);
    expect(err.join('\n')).toContain('不要盲目重试');
    expect(err.join('\n')).toContain('good7ob idea get 21');
  });
});

describe('idea correction', () => {
  const correction = { productId: 12, effort: factor(1.25, 4), cycle: factor(1, 1), cost: factor(1, 0) };

  it('GETs the product endpoint and renders all three dimensions', async () => {
    const r = await idea(['correction', '12'], ok(correction));
    expect(r.http.get).toHaveBeenCalledWith('/forge/products/12/estimation-correction', { params: undefined });
    expect(r.stdout).toContain('产品 #12');
    expect(r.stdout).toContain('人日');
    expect(r.stdout).toContain('周期');
    expect(r.stdout).toContain('成本');
    expect(r.stdout).toContain('1.25');
    expect(r.stdout).toContain('已按历史偏差修正');
    expect(r.stdout).toContain('历史样本不足');
  });

  it('renders missing dimensions as "—", never as 0', async () => {
    const r = await idea(['correction', '12'], ok({ productId: 12, effort: null, cycle: { factor: null, sampleSize: null } }));
    const rows = r.stdout.split('\n').filter((l) => /^(人日|周期|成本)/.test(l));
    expect(rows).toHaveLength(3);
    rows.forEach((l) => expect(l).toContain('—'));
    expect(rows.join('\n')).not.toMatch(/\b0\b/);
  });

  it('--json, bad id, and error mapping', async () => {
    const json = await idea(['correction', '12', '--json'], ok(correction));
    expect(JSON.parse(json.stdout)).toEqual(correction);
    await expectRejected(['correction', 'x'], 'productId');
    const denied = await idea(['correction', '12'], bizError(2000, 'not a member'));
    expect(denied.stderr).toContain('无权访问');
  });
});

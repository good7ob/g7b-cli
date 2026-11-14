/** prd-0091 FP-24 (g7b #3292): `pm task create` --template / --no-template, readable 1001 rejection, warnings. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { registerTaskCommands } from '../index';
import { describeTemplateReject, printWarnings, templateFields } from '../templateReject';
import { AgentStateStore, IDLE } from '../../../agent/state';
import { bizError, ok, runCli } from '../../../../utils/__tests__/cliHarness';

const register = (program: Command) => registerTaskCommands(program.command('pm'));
const create = (args: string[], response = ok({ id: 55 }) as never) =>
  runCli(register, ['pm', 'task', 'create', '--project-id', '4', '--name', 'Child', ...args], response);
const err = (message: string, code = 1001) => Object.assign(new Error(message), { code });

afterEach(() => vi.restoreAllMocks());

describe('templateFields', () => {
  it('maps --template to templateId and --no-template to noTemplate', () => {
    expect(templateFields({ template: '12' })).toEqual({ templateId: 12 });
    expect(templateFields({ template: false })).toEqual({ noTemplate: true });
    expect(templateFields({})).toEqual({});
  });
  it('rejects both together and a bad id', () => {
    expect(() => templateFields({ template: '12' }, { template: true, noTemplate: true })).toThrow('不能同时');
    expect(() => templateFields({ template: 'x' })).toThrow('--template');
  });
});

describe('describeTemplateReject', () => {
  it('lists each mismatch on its own line with a fix', () => {
    const text = describeTemplateReject(err(
      '项目已强制使用模板，内容不符：标题超过 30 字（现 31 字）；标题含类名「UserService」，这类内容不进标题；标题格式应为「[范围] 动作 + 对象」，缺少 [范围]'))!;
    const lines = text.split('\n');
    expect(lines[0]).toBe('创建被拒：项目已强制使用模板');
    expect(text).toContain('标题超过 30 字（现 31 字）');
    expect(text).toContain('缩短到 30 字内');
    expect(text).toContain('标题含类名「UserService」，这类内容不进标题');
    expect(text).toContain('放进描述');
    expect(text).toContain('[范围] 动作 + 对象');
    expect(text).toContain('任务命名规范');
    expect(text.match(/^ {2}· /gm)).toHaveLength(3);
  });
  it.each([['组织'], ['项目'], ['产品']])('names the %s layer', (layer) =>
    expect(describeTemplateReject(err(`${layer}已强制使用模板，内容不符：标题不能为空`))).toContain(`创建被拒：${layer}已强制使用模板`));
  it('swap / skip attempts point at the flags to drop', () => {
    expect(describeTemplateReject(err('组织已强制使用模板，不能选「不套模板」'))).toContain('--no-template');
    expect(describeTemplateReject(err('产品已强制使用模板，不能更换模板'))).toContain('--template');
  });
  it('keeps an unknown item without a fix', () => {
    const text = describeTemplateReject(err('项目已强制使用模板，内容不符：某新规则'))!;
    expect(text).toContain('· 某新规则');
    expect(text).not.toContain('改法');
  });
  it('leaves other errors alone', () => {
    expect(describeTemplateReject(err('参数错误'))).toBeUndefined();
    expect(describeTemplateReject(err('项目已强制使用模板，内容不符：x', 2000))).toBeUndefined();
    expect(describeTemplateReject(new Error('boom'))).toBeUndefined();
  });
});

describe('printWarnings', () => {
  it('prints one 提示 line per warning', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    printWarnings({ id: 1, warnings: [{ field: 'title', message: '标题超过 30 字' }, { message: '缺少描述' }] });
    expect(log.mock.calls.map((c) => c[0])).toEqual(['提示：标题超过 30 字', '提示：缺少描述']);
  });
  it('does nothing without warnings', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    printWarnings({ id: 1 });
    printWarnings({ id: 1, warnings: [] });
    printWarnings(null);
    expect(log).not.toHaveBeenCalled();
  });
});

describe('pm task create (CLI)', () => {
  const idle = () => vi.spyOn(AgentStateStore.prototype, 'read').mockReturnValue(IDLE);

  it('sends templateId / noTemplate only when asked', async () => {
    idle();
    expect((await create([])).http.post.mock.calls[0][1]).not.toHaveProperty('templateId');
    expect((await create([])).http.post.mock.calls[0][1]).not.toHaveProperty('noTemplate');
    expect((await create(['--template', '9'])).http.post.mock.calls[0][1]).toEqual(expect.objectContaining({ templateId: 9 }));
    expect((await create(['--no-template'])).http.post.mock.calls[0][1]).toEqual(expect.objectContaining({ noTemplate: true }));
  });
  it('--template with --no-template fails locally, in either order, without any request', async () => {
    idle();
    for (const args of [['--template', '9', '--no-template'], ['--no-template', '--template', '9']]) {
      const r = await create(args);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain('不能同时');
      expect(r.http.post).not.toHaveBeenCalled();
    }
  });
  it('prints warnings after the success line, exit 0', async () => {
    idle();
    const r = await create([], ok({ id: 55, warnings: [{ field: 'title', message: '标题含字段名「user_id」' }] }));
    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toMatch(/已创建: \[55\] Child[\s\S]*提示：标题含字段名「user_id」/);
  });
  it('--json keeps warnings in the output and adds no 提示 lines', async () => {
    idle();
    const r = await create(['--json'], ok({ id: 55, warnings: [{ field: 'title', message: 'm' }] }));
    expect(JSON.parse(r.stdout).warnings).toEqual([{ field: 'title', message: 'm' }]);
    expect(r.stdout).not.toContain('提示：');
  });
  it('an enforced rejection is readable and exits 1', async () => {
    idle();
    const r = await create([], bizError(1001, '项目已强制使用模板，内容不符：标题超过 30 字（现 31 字）'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('创建被拒：项目已强制使用模板');
    expect(r.stderr).toContain('缩短到 30 字内');
  });
  it('another 1001 keeps the old output', async () => {
    idle();
    const r = await create([], bizError(1001, '父任务不存在'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('✗ 创建任务失败: 父任务不存在');
    expect(r.stderr).not.toContain('创建被拒');
  });
});

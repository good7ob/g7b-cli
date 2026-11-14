import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerTemplateCommands } from '../index';
import { bizError, noHttpCalls, ok, runCli } from '../../../utils/__tests__/cliHarness';

const tpl = (args: string[], response = ok(null)) => runCli(registerTemplateCommands, ['template', 'setting', ...args], response);

afterEach(() => vi.restoreAllMocks());

async function expectRejected(args: string[], needle: string) {
  const r = await tpl(args);
  expect(r.exitCode).toBe(1);
  expect(r.stderr).toContain('参数错误');
  expect(r.stderr).toContain(needle);
  expect(noHttpCalls(r)).toBe(true);
}

const effective = (o: Record<string, unknown>) => ({
  applied: true, enforced: false, mode: null, templateId: null, templateName: null, version: null, skippedEnforcements: [], ...o,
});

const projectVo = {
  scopeType: 'PROJECT', scopeId: 12, orgId: 3,
  items: [{
    templateType: 'TASK', modeSupported: true,
    setting: { settingId: 1, templateId: 8, templateName: '项目任务模板', mode: 'RECOMMEND', valid: false, invalidReason: '模板已下架' },
    readOnly: true, readOnlyReason: 'ORG_ENFORCED',
    orgEnforced: { templateId: 5, templateName: '组织任务模板', versionId: 50, version: '1.2.0', settingId: 9 },
    effective: effective({
      layer: 'ORG_ENFORCE', enforced: true, mode: 'ENFORCE', templateId: 5, templateName: '组织任务模板', version: '1.2.0',
      skippedEnforcements: [{ layer: 'CONTAINER_ENFORCE', templateId: 8, reason: '组织强制优先' }],
    }),
  }],
};

describe('template setting get', () => {
  it('GETs /templates/settings with scopeType / scopeId / orgId and renders effective result, read-only and invalid marks', async () => {
    const r = await tpl(['get', '--scope', 'project', '--id', '12', '--org', '3'], ok(projectVo));
    expect(r.http.get).toHaveBeenCalledWith('/templates/settings', { params: { scopeType: 'PROJECT', scopeId: 12, orgId: 3 } });
    expect(r.stdout).toContain('范围: 项目 #12（组织 #3）');
    expect(r.stdout).toMatch(/TASK\s+#8 项目任务模板（已失效）\s+推荐\s+组织强制：#5 组织任务模板 v1\.2\.0\s+强制/);
    expect(r.stdout).toContain('TASK: 组织已强制，只读（组织所选 #5 组织任务模板 v1.2.0）');
    expect(r.stdout).toContain('TASK: 本层设置已失效，视为没设（模板已下架）');
    expect(r.stdout).toContain('跳过了 项目/产品强制 #8（组织强制优先）');
  });

  it('org scope takes its id from --org and sends no orgId; --json prints the response untouched', async () => {
    const vo = { scopeType: 'ORGANIZATION', scopeId: 3, items: [{ templateType: 'PRD', modeSupported: true, setting: null, effective: null }] };
    const r = await tpl(['get', '--scope', 'org', '--org', '3', '--json'], ok(vo));
    expect(r.http.get).toHaveBeenCalledWith('/templates/settings', { params: { scopeType: 'ORGANIZATION', scopeId: 3 } });
    expect(JSON.parse(r.stdout)).toEqual(vo);
  });

  it('user scope needs neither id nor org; personal rows show no mode', async () => {
    const vo = {
      scopeType: 'USER', items: [{
        templateType: 'UI', modeSupported: false,
        setting: { settingId: 2, templateId: 7, templateName: '我的 UI', mode: null, valid: true },
        effective: effective({ layer: 'PERSONAL', templateId: 7, templateName: '我的 UI', version: '1.0.0' }),
      }],
    };
    const r = await tpl(['get', '--scope', 'user'], ok(vo));
    expect(r.http.get).toHaveBeenCalledWith('/templates/settings', { params: { scopeType: 'USER' } });
    expect(r.stdout).toMatch(/UI\s+#7 我的 UI\s+—\s+个人：#7 我的 UI v1\.0\.0\s+—/);
  });

  it('--type filters the rows client-side', async () => {
    const vo = { scopeType: 'PRODUCT', scopeId: 9, orgId: 3, items: [
      { templateType: 'PRD', modeSupported: true, setting: null, effective: effective({ layer: 'NONE' }) },
      { templateType: 'API', modeSupported: true, setting: null, effective: effective({ layer: 'NONE' }) }] };
    const r = await tpl(['get', '--scope', 'product', '--id', '9', '--org', '3', '--type', 'api'], ok(vo));
    expect(r.stdout).toContain('API');
    expect(r.stdout).not.toContain('PRD');
  });

  it('validates scope / id / org before any request', async () => {
    await expectRejected(['get', '--scope', 'team'], '--scope 取值无效');
    await expectRejected(['get', '--scope', 'project', '--org', '3'], '--scope project 必须带 --id');
    await expectRejected(['get', '--scope', 'project', '--id', '12'], '--scope project 必须带 --org');
    await expectRejected(['get', '--scope', 'org', '--id', 'x'], '--id 必须是正整数');
    await expectRejected(['get', '--scope', 'user', '--type', 'WORKFLOW'], '--type 取值无效');
  });
});

describe('template setting set', () => {
  it('PUTs the body with upper-cased mode and prints the result', async () => {
    const vo = { scopeType: 'ORGANIZATION', scopeId: 3, items: [{
      templateType: 'TASK', modeSupported: true,
      setting: { settingId: 1, templateId: 5, templateName: '组织任务模板', mode: 'ENFORCE', valid: true }, effective: null }] };
    const r = await tpl(['set', '--scope', 'org', '--id', '3', '--type', 'task', '--template', '5', '--mode', 'enforce'], ok(vo));
    expect(r.http.put).toHaveBeenCalledWith('/templates/settings',
      { scopeType: 'ORGANIZATION', scopeId: 3, templateType: 'TASK', templateId: 5, mode: 'ENFORCE' });
    expect(r.stdout).toContain('✓ 已设置 TASK 的生效模板');
    expect(r.stdout).toMatch(/TASK\s+#5 组织任务模板\s+强制/);
  });

  it('omits mode when not given (backend keeps the existing one)', async () => {
    const r = await tpl(['set', '--scope', 'ai-employee', '--id', '4', '--org', '3', '--type', 'PRD', '--template', '6'], ok({ items: [] }));
    expect(r.http.put).toHaveBeenCalledWith('/templates/settings',
      { scopeType: 'AI_EMPLOYEE', scopeId: 4, orgId: 3, templateType: 'PRD', templateId: 6 });
  });

  it('rejects --mode for user / ai-employee and bad input before any request', async () => {
    await expectRejected(['set', '--scope', 'user', '--type', 'PRD', '--template', '6', '--mode', 'recommend'], '没有模式');
    await expectRejected(['set', '--scope', 'org', '--id', '3', '--type', 'PRD', '--template', '6', '--mode', 'force'], '--mode 取值无效');
    await expectRejected(['set', '--scope', 'org', '--id', '3', '--type', 'PRD', '--template', '0'], '--template 必须是正整数');
  });

  it.each([
    [2000, '没有权限：写入需要组织 owner/admin'],
    [1007, '组织已强制该类型：项目 / 产品不能修改'],
    [1002, '对象不存在或不属于该组织'],
  ])('maps business error %i to a readable hint', async (code, text) => {
    const r = await tpl(['set', '--scope', 'product', '--id', '9', '--org', '3', '--type', 'PRD', '--template', '6'], bizError(code, '后端消息'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain(text);
    expect(r.stderr).toContain(`[${code}`);
  });

  it('1001 keeps the backend message verbatim', async () => {
    const r = await tpl(['set', '--scope', 'org', '--id', '3', '--type', 'PRD', '--template', '6'], bizError(1001, '模板类型与设置类型不一致'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('类型、范围或模板不符');
    expect(r.stderr).toContain('模板类型与设置类型不一致');
  });
});

describe('template setting clear', () => {
  it('DELETEs with the scope and type in the query string', async () => {
    const r = await tpl(['clear', '--scope', 'project', '--id', '12', '--org', '3', '--type', 'task'], ok({ scopeType: 'PROJECT', scopeId: 12, orgId: 3, items: [] }));
    expect(r.http.delete).toHaveBeenCalledWith('/templates/settings?scopeType=PROJECT&scopeId=12&orgId=3&templateType=TASK', undefined);
    expect(r.stdout).toContain('✓ 已清除 TASK 的设置');
  });

  it('shows the org-enforced hint on 1007 and requires --type', async () => {
    const r = await tpl(['clear', '--scope', 'product', '--id', '9', '--org', '3', '--type', 'PRD'], bizError(1007, '组织已强制该类型'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('组织已强制该类型：项目 / 产品不能修改');
    const missing = await tpl(['clear', '--scope', 'user']);
    expect(missing.exitCode).toBe(1);
    expect(noHttpCalls(missing)).toBe(true);
  });
});

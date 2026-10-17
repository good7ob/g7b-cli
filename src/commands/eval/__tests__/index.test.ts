import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { buildStartBody, readItems, toKind } from '../index';

describe('toKind', () => {
  it('maps the design kinds to API enums', () => {
    expect(toKind('api')).toBe('API_DESIGN');
    expect(toKind('db')).toBe('DB_DESIGN');
    expect(toKind('arch')).toBe('ARCH_DESIGN');
    expect(toKind('prd')).toBe('PRD_VERSION');
  });
  it('rejects unknown kinds', () => {
    expect(() => toKind('code')).toThrow('对象种类');
  });
});

describe('buildStartBody', () => {
  it('defaults to external: no model, no data-flow confirmation', () => {
    const body: any = buildStartBody('api', '12', { template: '7', org: '58' });
    expect(body.judgeMode).toBe('EXTERNAL');
    expect(body.judge).toBeUndefined();
    expect(body.target).toEqual({ type: 'ARTIFACT', kind: 'API_DESIGN', id: 12 });
    expect(body.confirmations).toEqual({ cost: true, dataFlow: false, duplicate: false });
  });
  it('external refuses a model', () => {
    expect(() => buildStartBody('api', '12', { template: '7', model: '3' })).toThrow('不能带 --model');
  });
  it('platform needs a model and an explicit --yes', () => {
    expect(() => buildStartBody('db', '1', { template: '7', mode: 'platform' })).toThrow('--model');
    expect(() => buildStartBody('db', '1', { template: '7', mode: 'platform', model: '3' })).toThrow('--yes');
    const body: any = buildStartBody('db', '1', { template: '7', mode: 'platform', model: '3', yes: true });
    expect(body.judgeMode).toBe('PLATFORM');
    expect(body.judge).toEqual({ modelId: 3 });
    expect(body.confirmations.dataFlow).toBe(true);
  });
  it('rejects an unknown mode', () => {
    expect(() => buildStartBody('db', '1', { template: '7', mode: 'auto' })).toThrow('--mode');
  });
});

describe('readItems', () => {
  const write = (content: string) => {
    const file = join(mkdtempSync(join(tmpdir(), 'eval-')), 'scores.json');
    writeFileSync(file, content);
    return file;
  };
  it('accepts an array or an items wrapper', () => {
    expect(readItems(write('[{"itemId":"1:a"}]'))).toHaveLength(1);
    expect(readItems(write('{"items":[{"itemId":"1:a"}]}'))).toHaveLength(1);
  });
  it('rejects empty and unreadable input', () => {
    expect(() => readItems(write('[]'))).toThrow('非空数组');
    expect(() => readItems(write('not json'))).toThrow('无法读取');
  });
});

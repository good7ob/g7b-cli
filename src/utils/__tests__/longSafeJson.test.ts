/**
 * Bugs 2119700415948099586 / 2119700641681346562: snowflake ids beyond Number.MAX_SAFE_INTEGER that the
 * backend sends as JSON numbers must survive parsing digit for digit.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../../services/ApiClient';
import { longSafeTransformResponse, parseJsonKeepingLongIds, quoteUnsafeIntegers } from '../longSafeJson';

const ID = '2119699347172331521';

describe('parseJsonKeepingLongIds', () => {
  it('returns an unsafe integer as its exact digits (JSON.parse would round it)', () => {
    expect(String(JSON.parse(`{"data":${ID}}`).data)).toBe('2119699347172331500');
    expect(parseJsonKeepingLongIds(`{"code":200,"data":${ID}}`)).toEqual({ code: 200, data: ID });
  });

  it('handles a bare top-level number, negatives, arrays and nesting', () => {
    expect(parseJsonKeepingLongIds(ID)).toBe(ID);
    expect(parseJsonKeepingLongIds(`[-${ID}, {"a": {"b": [${ID}]}}]`)).toEqual([`-${ID}`, { a: { b: [ID] } }]);
  });

  it('keeps safe integers, decimals and exponents as numbers', () => {
    expect(parseJsonKeepingLongIds('{"a":9007199254740991,"b":-263,"c":1794210989768,"d":1.5,"e":1e21,"f":0}')).toEqual({
      a: Number.MAX_SAFE_INTEGER, b: -263, c: 1794210989768, d: 1.5, e: 1e21, f: 0,
    });
    expect(parseJsonKeepingLongIds('12345678901234567.5')).toBe(12345678901234567.5);
  });

  it('leaves digits inside strings alone, escaped quotes included', () => {
    const text = `{"id":"${ID}","note":"say \\"${ID}\\" twice","n":${ID}}`;
    expect(parseJsonKeepingLongIds(text)).toEqual({ id: ID, note: `say "${ID}" twice`, n: ID });
  });

  it('returns text without long numbers unchanged', () => {
    const text = '{"id":"5","n":42}';
    expect(quoteUnsafeIntegers(text)).toBe(text);
  });
});

describe('longSafeTransformResponse', () => {
  it('parses JSON and hands back a non-JSON body as text, like axios', () => {
    expect(longSafeTransformResponse.call({}, `{"data":${ID}}`)).toEqual({ data: ID });
    expect(longSafeTransformResponse.call({}, '<html>502</html>')).toBe('<html>502</html>');
    expect(longSafeTransformResponse.call({}, '')).toBe('');
  });

  it('does not touch non-string or non-JSON response types', () => {
    const buf = Buffer.from('{}');
    expect(longSafeTransformResponse.call({}, buf)).toBe(buf);
    expect(longSafeTransformResponse.call({ responseType: 'text' }, `{"data":${ID}}`)).toBe(`{"data":${ID}}`);
  });
});

describe('ApiClient response parsing', () => {
  const http = apiClient['instance'];
  const adapter = http.defaults.adapter;
  afterEach(() => {
    http.defaults.adapter = adapter;
    vi.restoreAllMocks();
  });

  function serve(raw: string, status = 200) {
    http.defaults.adapter = async (config) => {
      const response = { data: raw, status, statusText: String(status), headers: {}, config, request: {} };
      if (status >= 400) throw Object.assign(new Error(`Request failed with status code ${status}`), { response, config });
      return response;
    };
  }

  it('unwraps a bare Long `data` (POST /api/infra/applications) as the exact id string', async () => {
    serve(`{"code":200,"msg":"操作成功","success":true,"data":${ID}}`);
    await expect(apiClient.post('/api/infra/applications', {})).resolves.toBe(ID);
  });

  it('keeps an entity id already sent as a string and nested long ids exact', async () => {
    serve(`{"code":200,"data":{"bug":{"id":"${ID}","projectId":4,"caseId":${ID}},"history":[]}}`);
    await expect(apiClient.get(`/qc/bugs/${ID}`)).resolves.toEqual({ bug: { id: ID, projectId: 4, caseId: ID }, history: [] });
  });

  it('still reads the business message of an error body', async () => {
    serve('{"code":404,"msg":"Bug 不存在"}', 404);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(apiClient.get(`/qc/bugs/${ID}`)).rejects.toThrow('Bug 不存在');
  });
});

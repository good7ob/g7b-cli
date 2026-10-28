import { describe, expect, it } from 'vitest';
import { parseReportFile } from '../pipeline';

describe('parseReportFile', () => {
  it('接受结果数组', () => {
    expect(parseReportFile('[{"caseId":1,"result":"Passed"}]')).toHaveLength(1);
  });

  it('接受带 results 的对象', () => {
    expect(parseReportFile('{"results":[{"caseId":1,"result":"Failed","failureMessage":"x"}]}')).toHaveLength(1);
  });

  it('空数组或缺少字段时报错', () => {
    expect(() => parseReportFile('[]')).toThrow();
    expect(() => parseReportFile('[{"result":"Passed"}]')).toThrow();
    expect(() => parseReportFile('[{"caseId":"1","result":"Passed"}]')).toThrow();
  });
});

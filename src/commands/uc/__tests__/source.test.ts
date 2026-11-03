import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_PNG_BYTES, SCAN_PNG_BYTES, checkPngSize, normalizeSource, readSourceFile, sourceHash } from '../source';

// The standard vectors of the backend's UseCaseSourceHashTest (api-0180 §13.1).
describe('rp-ucase-0064 hash rule shared with the server', () => {
  it('is sha256 of the UTF-8 bytes after line ends become LF', () => {
    expect(sourceHash('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sourceHash('a\r\nb\rc\nd')).toBe(sourceHash('a\nb\nc\nd'));
    expect(normalizeSource('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
  });

  it('normalizes nothing but line ends', () => {
    expect(sourceHash('a\n')).not.toBe(sourceHash('a'));
    expect(sourceHash(' a')).not.toBe(sourceHash('a'));
    expect(sourceHash('﻿a')).not.toBe(sourceHash('a'));
  });

  it('hashes UTF-8 (e4 b8 ad), not UTF-16 or the platform charset', () => {
    expect(sourceHash('中')).toBe('a567bdaa11367f260f0708391f4d10766b5962f565d9e432f17981a3584fe1e2');
    expect(sourceHash('中')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('readSourceFile', () => {
  let dir: string;
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-source-')); });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (name: string, content: string) => { const p = path.join(dir, name); fs.writeFileSync(p, content); return p; };

  it('returns the text with LF line ends, the exact text that is rendered, hashed and sent', () => {
    expect(readSourceFile(write('a.puml', '@startuml\r\nA -> B\r\n@enduml\r\n'))).toBe('@startuml\nA -> B\n@enduml\n');
  });

  it('rejects missing, empty, BOM and oversized sources before anything is rendered', () => {
    expect(() => readSourceFile(path.join(dir, 'none.puml'))).toThrow('找不到');
    expect(() => readSourceFile(dir)).toThrow('不是文件');
    expect(() => readSourceFile(write('e.puml', '  \n'))).toThrow('空的');
    expect(() => readSourceFile(write('b.puml', '﻿@startuml\n@enduml\n'))).toThrow('BOM');
    expect(() => readSourceFile(write('big.puml', `@startuml\n${'x'.repeat(50_000)}\n@enduml\n`))).toThrow('50000');
  });
});

describe('rp-ucase-0068 PNG size against the object-file limit', () => {
  it('passes small images, warns above the virus-scan limit, refuses above the object-file limit', () => {
    expect(checkPngSize(1024)).toEqual({});
    expect(checkPngSize(SCAN_PNG_BYTES + 1).warning).toContain('病毒扫描');
    expect(checkPngSize(SCAN_PNG_BYTES + 1).error).toBeUndefined();
    expect(checkPngSize(MAX_PNG_BYTES).error).toBeUndefined();
    expect(checkPngSize(MAX_PNG_BYTES + 1).error).toContain('100.0 MB');
  });
});

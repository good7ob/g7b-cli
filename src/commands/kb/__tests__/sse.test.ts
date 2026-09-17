import { describe, expect, it } from 'vitest';
import { parseSseBuffer } from '../sse';

describe('parseSseBuffer', () => {
  it('parses Spring-style events and keeps the unterminated tail', () => {
    const buf = 'event:message\ndata:{"content":"a","done":false}\n\nevent:error\ndata:{"error":"x"}\n\nevent:mess';
    const { events, rest } = parseSseBuffer(buf);
    expect(events).toEqual([
      { event: 'message', data: '{"content":"a","done":false}' },
      { event: 'error', data: '{"error":"x"}' },
    ]);
    expect(rest).toBe('event:mess');
  });

  it('accepts CRLF, a space after the colon, and defaults event to message', () => {
    const { events, rest } = parseSseBuffer('data: {"done":true}\r\n\r\n');
    expect(events).toEqual([{ event: 'message', data: '{"done":true}' }]);
    expect(rest).toBe('');
  });
});

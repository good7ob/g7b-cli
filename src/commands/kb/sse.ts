export interface SseEvent {
  event: string;
  data: string;
}

/**
 * Split an SSE buffer into complete events plus the unterminated tail.
 * Spring's SseEmitter writes `event:<name>\ndata:<json>\n\n` with no space
 * after the colon; the spec allows either form, so both are accepted.
 */
export function parseSseBuffer(buffer: string): { events: SseEvent[]; rest: string } {
  const blocks = buffer.replace(/\r\n/g, '\n').split('\n\n');
  const rest = blocks.pop() ?? '';
  const events = blocks
    .map((block) => {
      let event = 'message';
      const data: string[] = [];
      block.split('\n').forEach((line) => {
        const idx = line.indexOf(':');
        if (idx <= 0) return;
        const field = line.slice(0, idx);
        const value = line.slice(idx + 1).replace(/^ /, '');
        if (field === 'event') event = value;
        else if (field === 'data') data.push(value);
      });
      return { event, data: data.join('\n') };
    })
    .filter((e) => e.data !== '');
  return { events, rest };
}

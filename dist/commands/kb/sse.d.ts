export interface SseEvent {
    event: string;
    data: string;
}
/**
 * Split an SSE buffer into complete events plus the unterminated tail.
 * Spring's SseEmitter writes `event:<name>\ndata:<json>\n\n` with no space
 * after the colon; the spec allows either form, so both are accepted.
 */
export declare function parseSseBuffer(buffer: string): {
    events: SseEvent[];
    rest: string;
};
//# sourceMappingURL=sse.d.ts.map
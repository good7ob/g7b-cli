import { ApiDate } from '../../utils/cliHelpers';
export interface TraceLink {
    id: number;
    productId?: number;
    sourceType?: string | null;
    sourceId?: number | null;
    targetType?: string | null;
    targetId?: number | null;
    linkType?: string | null;
    createdBy?: number | null;
    createdAt?: ApiDate;
}
export declare function renderTraceList(result: unknown, pageNum: number, pageSize: number): string;
/** `IDEA#5 —derived_from→ REQUIREMENT#9` */
export declare function describeLink(l: TraceLink): string;
//# sourceMappingURL=render.d.ts.map
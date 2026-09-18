/**
 * Pure helpers for `good7ob prd import-structure`: parse docs/prd (requirement index + FP/RP
 * tables), map onto the backend's Feature / Function Point / Rule Point enums, and sync
 * idempotently through an injected client. Kept free of apiClient so it can be unit tested.
 */
export declare const INDEX_FILE = "prd-0000-good7ob-requirement-index.md";
/** forge_feature.name / forge_function_point.name are VARCHAR(100). */
export declare const NAME_MAX = 100;
export declare const FP_TYPES: string[];
export declare const RP_TYPES: string[];
type IndexStatus = 'TODO' | 'IN_PROGRESS' | 'DONE' | 'SKIP';
export interface IndexRow {
    featureId: string;
    featureName: string;
    funId: string;
    desc: string;
    status: IndexStatus;
    prdLink?: string;
}
export interface PrdRp {
    rpId: string;
    text: string;
    type: string;
}
export interface PrdFp {
    funId: string;
    fpType?: string;
    rps: PrdRp[];
}
export interface ParsedStructure {
    rows: IndexRow[];
    prdFps: PrdFp[];
}
export interface Verified {
    fpStatus: Record<string, string>;
    rpImplStatus: Record<string, string>;
}
export interface DesiredRp {
    key: string;
    statement: string;
    rpType: string;
    implStatus: string;
}
export interface DesiredFp {
    key: string;
    name: string;
    fpType: string;
    description?: string;
    status: string;
    rps: DesiredRp[];
}
export interface DesiredFeature {
    key: string;
    name: string;
    fps: DesiredFp[];
}
export declare function parseIndex(md: string): IndexRow[];
/** One PRD file → its FP sections (FP ID line + Rule Points rows), fpType from the FP summary table. */
export declare function parsePrd(md: string): PrdFp[];
export declare function loadStructure(prdDir: string): ParsedStructure;
export declare function parseVerified(raw: unknown): Verified;
export declare const mapFpType: (t?: string) => string;
export declare const mapRpType: (t?: string) => string;
export declare function fpStatusFor(funId: string, indexStatus: IndexStatus, v?: Verified): string;
/** Only RPs under a verified FP carry a verdict; unlisted ones there are DONE, everything else is unverified work → TODO. */
export declare function rpImplStatusFor(funId: string, rpId: string, v?: Verified): string;
/** Truncate to max UTF-16 units without splitting a surrogate pair; the leading id token always survives. */
export declare function clip(s: string, max: number): string;
export declare function buildDesired(parsed: ParsedStructure, verified?: Verified): {
    features: DesiredFeature[];
    warnings: string[];
};
export declare function summarize(features: DesiredFeature[]): {
    features: number;
    fps: number;
    rps: number;
    fpStatus: Record<string, number>;
    rpImplStatus: Record<string, number>;
};
export interface StructureClient {
    get(url: string, params?: Record<string, any>): Promise<any>;
    post(url: string, body?: any): Promise<any>;
    put(url: string, body?: any): Promise<any>;
}
export type Layer = 'feature' | 'fp' | 'rp';
export interface SyncAction {
    layer: Layer;
    op: 'create' | 'update';
    id: string;
    field?: string;
    from?: string;
    to?: string;
}
export interface SyncResult {
    counts: Record<Layer, {
        create: number;
        update: number;
        unchanged: number;
    }>;
    actions: SyncAction[];
}
/**
 * Create missing nodes, update FP status / RP implStatus only when different, never delete.
 * dryRun reads existing data and records the plan without writing.
 */
export declare function syncStructure(client: StructureClient, productId: number, features: DesiredFeature[], opts: {
    dryRun: boolean;
    concurrency: number;
    tenantId?: number;
}): Promise<SyncResult>;
export {};
//# sourceMappingURL=structure.d.ts.map
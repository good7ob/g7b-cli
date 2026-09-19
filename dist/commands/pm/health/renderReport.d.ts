import { ApiDate } from '../../../utils/cliHelpers';
/** Renderers for `pm health report generate|list|get` (api-0090 §13). */
export interface ReportItem {
    id: number;
    productId?: number | null;
    releaseId?: number | null;
    periodType?: string | null;
    periodFrom?: string | null;
    periodTo?: string | null;
    title?: string | null;
    aiPolished?: boolean | null;
    aiWarning?: string | null;
    createdBy?: number | null;
    createdAt?: ApiDate;
}
/** Generate and detail share this shape; `structured` holds the sections (shown with --json). */
export interface Report extends ReportItem {
    weightBasis?: string | null;
    contentMarkdown?: string | null;
    structured?: Record<string, unknown> | null;
    aiModel?: string | null;
}
export interface ReportPage {
    records?: ReportItem[] | null;
    total?: number | null;
    current?: number | null;
    size?: number | null;
    pages?: number | null;
}
/** Meta block shared by generate and get; the AI part is always spelled out. */
export declare function renderReportMeta(r: Report): string;
export declare function renderReport(r: Report, verb?: string): string;
export declare function renderReportList(page: ReportPage): string;
//# sourceMappingURL=renderReport.d.ts.map
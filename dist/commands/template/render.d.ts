import { ApiDate } from '../../utils/cliHelpers';
import { VersionVo } from './renderVersion';
export interface TagVo {
    id?: number | null;
    name?: string | null;
    kind?: string | null;
}
export interface TemplateCard {
    id: number;
    name?: string | null;
    templateType?: string | null;
    description?: string | null;
    categoryId?: number | null;
    visibility?: string | null;
    status?: string | null;
    ownerType?: string | null;
    ownerId?: number | null;
    orgId?: number | null;
    isOfficial?: boolean | null;
    pricingType?: string | null;
    price?: number | null;
    currency?: string | null;
    licenseType?: string | null;
    publishedVersion?: string | null;
    ratingAvg?: number | null;
    reviewCount?: number | null;
    favoriteCount?: number | null;
    installCount?: number | null;
    instantiateCount?: number | null;
    viewCount?: number | null;
    tags?: TagVo[] | null;
    favorited?: boolean | null;
    canManage?: boolean | null;
    suspendReason?: string | null;
    createdBy?: number | null;
    publishedAt?: ApiDate;
    createdAt?: ApiDate;
    updatedAt?: ApiDate;
}
export interface TemplateDetail extends TemplateCard {
    version?: VersionVo | null;
}
/** The backend answers 0.00 for a template nobody rated; that is "no rating", never a rating of 0. */
export declare const fmtRating: (t: Pick<TemplateCard, 'ratingAvg' | 'reviewCount'>) => string;
/** Paged footer shared by every list; `total` falls back to the page length when the server omits it. */
export declare function pageFooter(result: unknown, records: unknown[], pageNum: number, pageSize: number): string;
export declare function renderTemplateList(result: unknown, pageNum: number, pageSize: number, empty?: string): string;
export declare function renderTemplateHeader(t: TemplateCard): string[];
export declare function renderTemplateDetail(t: TemplateDetail): string;
//# sourceMappingURL=render.d.ts.map
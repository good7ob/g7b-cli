/** Renderers for categories, tags, reviews, packages and the admin review queue. */
import { ApiDate } from '../../utils/cliHelpers';
export declare function renderCategories(result: unknown): string;
export declare function renderTags(result: unknown): string;
interface ReviewVo {
    id?: number;
    templateId?: number;
    userId?: number;
    rating?: number | null;
    comment?: string | null;
    createdAt?: ApiDate;
    updatedAt?: ApiDate;
}
export declare function renderReviewList(result: unknown, pageNum: number, pageSize: number): string;
export declare function renderReviewSaved(r: ReviewVo, templateId: number): string;
interface PackageItemVo {
    templateId?: number;
    templateName?: string | null;
    templateType?: string | null;
    templateStatus?: string | null;
    publishedVersion?: string | null;
    versionConstraint?: string | null;
}
export interface PackageVo {
    id: number;
    name?: string | null;
    description?: string | null;
    visibility?: string | null;
    status?: string | null;
    ownerType?: string | null;
    ownerId?: number | null;
    orgId?: number | null;
    pricingType?: string | null;
    isOfficial?: boolean | null;
    installCount?: number | null;
    instantiateCount?: number | null;
    canManage?: boolean | null;
    createdBy?: number | null;
    createdAt?: ApiDate;
    updatedAt?: ApiDate;
    items?: PackageItemVo[] | null;
}
export declare function renderPackageList(result: unknown, pageNum: number, pageSize: number): string;
export declare function renderPackage(p: PackageVo): string;
export declare function renderReviewQueue(result: unknown, pageNum: number, pageSize: number): string;
export {};
//# sourceMappingURL=renderMisc.d.ts.map
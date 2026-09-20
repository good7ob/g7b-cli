import { ApiDate } from '../../utils/cliHelpers';
export interface DependencyVo {
    id?: number | null;
    versionId?: number | null;
    requiredTemplateId?: number | null;
    requiredTemplateName?: string | null;
    minVersion?: string | null;
    kind?: string | null;
}
export interface VariableDef {
    name?: string | null;
    label?: string | null;
    type?: string | null;
    required?: boolean | null;
    default?: unknown;
    options?: string[] | null;
}
export interface VersionVo {
    id?: number;
    templateId?: number;
    version?: string | null;
    changelog?: string | null;
    status?: string | null;
    content?: unknown;
    variables?: VariableDef[] | null;
    compatibility?: unknown;
    previousVersionId?: number | null;
    submittedAt?: ApiDate;
    publishedAt?: ApiDate;
    reviewResult?: string | null;
    reviewComment?: string | null;
    reviewedBy?: number | null;
    reviewedAt?: ApiDate;
    createdBy?: number | null;
    createdAt?: ApiDate;
    updatedAt?: ApiDate;
    dependencies?: DependencyVo[] | null;
}
/** `content` is untrusted user text (api-0091 §1): printed as text only, control characters are stripped by `emit`. */
export declare function renderContent(content: unknown, label?: string): string[];
export declare function renderVariables(variables: VariableDef[] | null | undefined): string[];
export declare function renderDependencies(deps: DependencyVo[] | null | undefined): string[];
export declare function renderDependencyList(result: unknown): string;
export declare function renderVersionHeader(v: VersionVo): string[];
export declare function renderVersion(v: VersionVo): string;
/** The list endpoint carries no content / variables / dependencies. */
export declare function renderVersionList(result: unknown): string;
interface DiffEntry {
    path?: string | null;
    from?: string | null;
    to?: string | null;
}
interface DiffSet {
    added?: DiffEntry[] | null;
    changed?: DiffEntry[] | null;
    removed?: DiffEntry[] | null;
}
export interface DiffVo {
    from?: string | null;
    to?: string | null;
    identical?: boolean | null;
    truncated?: boolean | null;
    content?: DiffSet | null;
    variables?: DiffSet | null;
}
export declare function renderDiff(d: DiffVo): string;
export {};
//# sourceMappingURL=renderVersion.d.ts.map
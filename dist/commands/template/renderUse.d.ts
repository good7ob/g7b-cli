/**
 * Renderers for installs, instances and package instantiation. Every value may be null (the backend drops null
 * fields), shown as "—"; rendered content is untrusted user text: printed as text only (`emit` strips control chars).
 */
import { ApiDate } from '../../utils/cliHelpers';
import { DependencyCheckVo } from './renderCheck';
export interface CreatedObject {
    type?: string | null;
    id?: number | null;
    name?: string | null;
    ref?: string | null;
}
export interface InstanceVo {
    id?: number;
    templateId?: number;
    templateName?: string | null;
    templateType?: string | null;
    versionId?: number | null;
    version?: string | null;
    installationId?: number | null;
    orgId?: number | null;
    productId?: number | null;
    packageId?: number | null;
    variables?: Record<string, unknown> | null;
    renderedContent?: unknown;
    createdObjectType?: string | null;
    createdObjectId?: number | null;
    createdObjects?: CreatedObject[] | null;
    warnings?: string[] | null;
    status?: string | null;
    createdBy?: number | null;
    createdAt?: ApiDate;
}
export interface InstallationVo {
    id?: number;
    templateId?: number;
    templateName?: string | null;
    templateType?: string | null;
    templateStatus?: string | null;
    orgId?: number | null;
    versionId?: number | null;
    version?: string | null;
    publishedVersion?: string | null;
    upgradeAvailable?: boolean | null;
    installedAt?: ApiDate;
    updatedAt?: ApiDate;
    created?: boolean | null;
    dependencies?: DependencyCheckVo | null;
}
export interface PackageInstantiationVo {
    packageId?: number;
    packageName?: string | null;
    instances?: InstanceVo[] | null;
    createdObjectCount?: number | null;
    warnings?: string[] | null;
}
export declare function renderCreatedObjects(objects: CreatedObject[] | null | undefined): string[];
/** Result of `template use`. */
export declare function renderInstantiated(v: InstanceVo, writtenTo?: string): string;
/** `template instance <id>`. */
export declare function renderInstance(v: InstanceVo, writtenTo?: string): string;
export declare function renderInstanceList(result: unknown, pageNum: number, pageSize: number): string;
/** Result of `template package use`: one line per instance, then the total. */
export declare function renderPackageInstantiation(v: PackageInstantiationVo): string;
export declare function renderInstalled(v: InstallationVo): string;
export declare function renderInstalledList(result: unknown, pageNum: number, pageSize: number): string;
//# sourceMappingURL=renderUse.d.ts.map
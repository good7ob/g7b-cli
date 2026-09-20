/** Renderers for dependency checks and the version-upgrade prompt / preview (api-0091 §16, §18). */
import { DiffVo } from './renderVersion';
export interface DependencyCheckItem {
    templateId?: number;
    templateName?: string | null;
    kind?: string | null;
    minVersion?: string | null;
    installedVersion?: string | null;
    publishedVersion?: string | null;
    status?: string | null;
    installable?: boolean | null;
    depth?: number | null;
    requiredBy?: number | null;
}
export interface DependencyCheckVo {
    templateId?: number;
    version?: string | null;
    satisfied?: boolean | null;
    missingRequired?: number | null;
    items?: DependencyCheckItem[] | null;
    warnings?: string[] | null;
}
/** Table of the resolved dependency tree; `installable` items are what `--with-deps` would install. */
export declare function renderDependencyCheck(check: DependencyCheckVo): string[];
export interface UpgradeVo {
    instanceId?: number;
    templateId?: number;
    templateName?: string | null;
    currentVersion?: string | null;
    latestVersion?: string | null;
    upgradeAvailable?: boolean | null;
    reason?: string | null;
    diff?: DiffVo | null;
    note?: string | null;
}
export declare function renderUpgrade(v: UpgradeVo): string;
export interface UpgradePreviewVo {
    instanceId?: number;
    from?: string | null;
    to?: string | null;
    variables?: Record<string, unknown> | null;
    renderedContent?: unknown;
}
export declare function renderUpgradePreview(v: UpgradePreviewVo, writtenTo?: string): string;
//# sourceMappingURL=renderCheck.d.ts.map
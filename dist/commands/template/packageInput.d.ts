/** CLI-boundary validation for template packages (TemplatePackageService: <=30 items, version constraints, free only). */
export declare const MAX_ITEMS = 30;
type Body = Record<string, unknown>;
/** `<templateId>[:<constraint>]` where constraint is `*` | x.y.z | ^x.y.z | ~x.y.z | >=x.y.z (default `*`). */
export declare function parseItem(raw: string): {
    templateId: number;
    versionConstraint?: string;
};
export declare function parseItems(raw: string[]): Body[];
export interface PackageFlags {
    name?: string;
    description?: string;
    visibility?: string;
    org?: string;
    item?: string[];
    clearItems?: boolean;
}
export declare function buildPackageCreateBody(o: PackageFlags): Body;
/** Omitted flag = field unchanged; `--item` replaces all items. */
export declare function buildPackageUpdateBody(o: PackageFlags): Body;
/** `package list`: library (default), `--mine`, or `--org <id>`. */
export declare function buildPackageListRequest(o: {
    keyword?: string;
    mine?: boolean;
    org?: string;
    page?: string;
    pageSize?: string;
}): {
    url: string;
    params: Record<string, string | number>;
};
export {};
//# sourceMappingURL=packageInput.d.ts.map
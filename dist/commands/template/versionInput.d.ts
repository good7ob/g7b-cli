/**
 * CLI-boundary validation for template versions, dependencies, reviews and admin decisions.
 * Limits mirror TemplateVersionService / TemplateDependencyService / TemplateReviewService / TemplateModerationService.
 */
export declare const MAX_CHANGELOG = 5000;
export declare const MAX_COMMENT = 1000;
export declare const MAX_DEPENDENCIES = 20;
export declare const DEPENDENCY_KINDS: readonly ["requires", "optional"];
type Body = Record<string, unknown>;
/** `x.y.z`, each part 1-6 digits (the server compares numerically: 1.10.0 > 1.9.0). */
export declare function requireSemver(raw: string | undefined, label: string): string;
export interface PayloadFlags {
    changelog?: string;
    content?: string;
    contentFile?: string;
    variablesFile?: string;
    compatibilityFile?: string;
}
export interface Payload {
    changelog?: string;
    content?: Record<string, unknown>;
    variables?: unknown[];
    compatibility?: Record<string, unknown>;
}
/** Load + guard every JSON piece the user supplied (nothing is sent before all of them pass). */
export declare function loadPayload(o: PayloadFlags): Payload;
export declare function buildVersionAddBody(o: PayloadFlags & {
    version?: string;
}): Body;
/** Omitted flag = field unchanged; content and variables are re-validated together by the server. */
export declare function buildVersionUpdateBody(o: PayloadFlags): Body;
/** deps.json: an array, or `{ "dependencies": [...] }`; each `{requiredTemplateId, minVersion?, kind?}`. */
export declare function loadDependencies(file: string): DependencyBody[];
export interface DependencyBody extends Body {
    requiredTemplateId: number;
}
export declare function buildDependency(o: {
    template?: string;
    minVersion?: string;
    kind?: string;
}, labels?: {
    template: string;
    minVersion: string;
    kind: string;
}): DependencyBody;
export declare function buildReviewBody(o: {
    rating?: string;
    comment?: string;
}): Body;
/** Admin decision note: `required` for reject / suspend, optional (may be omitted) for approve / unsuspend. */
export declare function buildModerationBody(raw: string | undefined, flag: string, required: boolean): Body;
export {};
//# sourceMappingURL=versionInput.d.ts.map
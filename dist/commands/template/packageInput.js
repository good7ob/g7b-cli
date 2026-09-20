"use strict";
/** CLI-boundary validation for template packages (TemplatePackageService: <=30 items, version constraints, free only). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPackageListRequest = exports.buildPackageUpdateBody = exports.buildPackageCreateBody = exports.parseItems = exports.parseItem = exports.MAX_ITEMS = void 0;
const cliHelpers_1 = require("../../utils/cliHelpers");
const input_1 = require("./input");
exports.MAX_ITEMS = 30;
const CONSTRAINT = /^(\*|(\^|~|>=)?[0-9]{1,6}\.[0-9]{1,6}\.[0-9]{1,6})$/;
/** `<templateId>[:<constraint>]` where constraint is `*` | x.y.z | ^x.y.z | ~x.y.z | >=x.y.z (default `*`). */
function parseItem(raw) {
    const at = raw.indexOf(':');
    const templateId = (0, cliHelpers_1.parseId)(at < 0 ? raw : raw.slice(0, at), '--item 的 templateId');
    if (at < 0)
        return { templateId };
    const constraint = raw.slice(at + 1).trim();
    if (!CONSTRAINT.test(constraint)) {
        throw new cliHelpers_1.InputError(`--item 的版本约束必须是 * / x.y.z / ^x.y.z / ~x.y.z / >=x.y.z，收到: ${raw}`);
    }
    return { templateId, versionConstraint: constraint };
}
exports.parseItem = parseItem;
function parseItems(raw) {
    if (raw.length > exports.MAX_ITEMS)
        throw new cliHelpers_1.InputError(`--item 最多 ${exports.MAX_ITEMS} 个，当前 ${raw.length} 个`);
    const items = raw.map(parseItem);
    const ids = items.map((i) => i.templateId);
    if (new Set(ids).size !== ids.length)
        throw new cliHelpers_1.InputError('--item 的 templateId 不能重复');
    return items;
}
exports.parseItems = parseItems;
function applyFields(body, o) {
    if (o.description !== undefined)
        body.description = (0, cliHelpers_1.checkMaxLength)(o.description, input_1.MAX_DESCRIPTION, '--description');
    if (o.visibility !== undefined)
        body.visibility = (0, input_1.upperOneOf)(o.visibility, input_1.VISIBILITIES, '--visibility');
    if (o.item?.length && o.clearItems)
        throw new cliHelpers_1.InputError('--item 与 --clear-items 不能同时使用');
    if (o.item?.length)
        body.items = parseItems(o.item);
    else if (o.clearItems)
        body.items = [];
}
function buildPackageCreateBody(o) {
    const body = { name: (0, cliHelpers_1.requireText)(o.name, input_1.MAX_NAME, '--name').trim() };
    applyFields(body, o);
    if (o.org !== undefined)
        body.orgId = (0, cliHelpers_1.parseId)(o.org, '--org');
    if (body.visibility === 'ORGANIZATION' && body.orgId === undefined) {
        throw new cliHelpers_1.InputError('--visibility ORGANIZATION 只适用于组织模板包：请同时指定 --org <orgId>');
    }
    return body;
}
exports.buildPackageCreateBody = buildPackageCreateBody;
/** Omitted flag = field unchanged; `--item` replaces all items. */
function buildPackageUpdateBody(o) {
    const body = {};
    if (o.name !== undefined)
        body.name = (0, cliHelpers_1.requireText)(o.name, input_1.MAX_NAME, '--name').trim();
    applyFields(body, o);
    if (Object.keys(body).length === 0) {
        throw new cliHelpers_1.InputError('没有要修改的字段：至少指定 --name / --description / --visibility / --item / --clear-items 之一');
    }
    return body;
}
exports.buildPackageUpdateBody = buildPackageUpdateBody;
/** `package list`: library (default), `--mine`, or `--org <id>`. */
function buildPackageListRequest(o) {
    if (o.mine && o.org !== undefined)
        throw new cliHelpers_1.InputError('--mine 与 --org 不能同时使用');
    if (o.keyword !== undefined && (o.mine || o.org !== undefined)) {
        throw new cliHelpers_1.InputError('--keyword 只适用于模板包库（不带 --mine / --org）');
    }
    const params = (0, input_1.pageParams)(o);
    if (o.mine)
        return { url: '/templates/packages/mine', params };
    if (o.org !== undefined)
        return { url: `/templates/packages/org/${(0, cliHelpers_1.parseId)(o.org, '--org')}`, params };
    if (o.keyword?.trim())
        params.keyword = o.keyword.trim();
    return { url: '/templates/packages', params };
}
exports.buildPackageListRequest = buildPackageListRequest;
//# sourceMappingURL=packageInput.js.map
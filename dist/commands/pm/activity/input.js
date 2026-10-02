"use strict";
/**
 * CLI-boundary validation for `pm activity` (prd-0092 FP-6, api-0092): exactly one of
 * --project / --task; `--since` switches from page mode (pageNum/pageSize) to cursor mode
 * (sinceId/limit); `--type` / `--actor` filters exist only on the project endpoint.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPostBody = exports.buildListTarget = exports.ACTIVITY_ERROR_CODES = exports.MAX_SUMMARY = exports.MAX_LIMIT = exports.MAX_PAGE_SIZE = exports.POST_TYPES = exports.ACTOR_TYPES = void 0;
const cliHelpers_1 = require("../../../utils/cliHelpers");
exports.ACTOR_TYPES = ['USER', 'AGENT', 'SYSTEM'];
exports.POST_TYPES = ['NOTE', 'REPORT_UPLOADED'];
exports.MAX_PAGE_SIZE = 200;
exports.MAX_LIMIT = 200;
exports.MAX_SUMMARY = 500;
exports.ACTIVITY_ERROR_CODES = {
    1000: '缺少必填参数',
    1001: '参数值不合法（动态类型 / actorType 未知、sinceId / limit 越界、summary 超长、url 不是 https）',
    1002: '任务 / 项目不存在，或不属于你所在的组织',
    2000: '无权限：该 AI 员工的能力范围不含 task_read / comment，或任务在其产品范围之外',
};
function buildListTarget(o) {
    if ((o.project === undefined) === (o.task === undefined)) {
        throw new cliHelpers_1.InputError('--project <id> 与 --task <id> 必须且只能指定一个');
    }
    const url = o.project !== undefined
        ? `/progress/projects/${(0, cliHelpers_1.parseId)(o.project, '--project')}/activities`
        : `/progress/tasks/${(0, cliHelpers_1.parseId)(o.task, '--task')}/activities`;
    const params = {};
    if (o.since !== undefined) {
        if (o.page !== undefined || o.pageSize !== undefined) {
            throw new cliHelpers_1.InputError('--since 为游标模式，不能与 --page / --page-size 同时使用（分页数量请用 --limit）');
        }
        params.sinceId = (0, cliHelpers_1.parseIntInRange)(o.since, '--since', 0, Number.MAX_SAFE_INTEGER);
        params.limit = (0, cliHelpers_1.parseIntInRange)(o.limit ?? '50', '--limit', 1, exports.MAX_LIMIT);
    }
    else {
        if (o.limit !== undefined) {
            throw new cliHelpers_1.InputError('--limit 只在 --since 游标模式下有效，分页模式请用 --page-size');
        }
        params.pageNum = (0, cliHelpers_1.parseIntInRange)(o.page ?? '1', '--page', 1, 1000000);
        params.pageSize = (0, cliHelpers_1.parseIntInRange)(o.pageSize ?? '20', '--page-size', 1, exports.MAX_PAGE_SIZE);
    }
    if (o.task !== undefined && (o.type !== undefined || o.actor !== undefined)) {
        throw new cliHelpers_1.InputError('--type / --actor 只支持 --project（任务动态不做类型 / 来源过滤）');
    }
    if (o.type !== undefined) {
        const types = o.type.split(',').map((t) => t.trim()).filter(Boolean);
        if (!types.length)
            throw new cliHelpers_1.InputError('--type 不能为空（逗号分隔的动态类型，如 HANDOFF,NOTE）');
        params.types = Array.from(new Set(types.map((t) => (0, cliHelpers_1.normalizeTypeCode)(t, '--type')))).join(',');
    }
    if (o.actor !== undefined) {
        params.actorType = (0, cliHelpers_1.requireOneOf)(o.actor.trim().toUpperCase(), exports.ACTOR_TYPES, '--actor');
    }
    return { url, params };
}
exports.buildListTarget = buildListTarget;
function buildPostBody(o) {
    const taskId = (0, cliHelpers_1.parseId)(o.task, '--task');
    const summary = (0, cliHelpers_1.requireText)(o.summary, exports.MAX_SUMMARY, '--summary');
    const type = (0, cliHelpers_1.requireOneOf)((o.type ?? 'NOTE').trim().toUpperCase(), exports.POST_TYPES, '--type');
    const body = { type, summary };
    if (o.url !== undefined) {
        const url = (0, cliHelpers_1.checkMaxLength)(o.url.trim(), 2048, '--url');
        if (!/^https:\/\/\S+$/.test(url))
            throw new cliHelpers_1.InputError(`--url 必须是 https:// 开头的地址，收到: ${o.url}`);
        body.metadata = { url };
    }
    return { taskId, body };
}
exports.buildPostBody = buildPostBody;
//# sourceMappingURL=input.js.map
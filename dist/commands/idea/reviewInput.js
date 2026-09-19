"use strict";
/**
 * CLI-boundary validation for `idea review` (EffectReviewUpdateDto / EffectMetricDto). Limits mirror
 * EffectReviewService: <= 20 metrics, name <= 100, unit <= 20, values with <= 4 decimals, notes <= 2000.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildReviewUpdateBody = exports.parseMetric = exports.REVIEW_ERROR_CODES = exports.MAX_NOTES = exports.MAX_METRIC_UNIT = exports.MAX_METRIC_NAME = exports.MAX_METRICS = void 0;
const cliHelpers_1 = require("../../utils/cliHelpers");
exports.MAX_METRICS = 20;
exports.MAX_METRIC_NAME = 100;
exports.MAX_METRIC_UNIT = 20;
exports.MAX_NOTES = 2000;
const METRIC_SCALE = 4;
// 14 integer digits, as the backend column allows (beyond 2^53 JSON numbers lose the last decimals; irrelevant for real metrics)
const MAX_INT_DIGITS = 14;
exports.REVIEW_ERROR_CODES = {
    1001: '参数值不合法（指标名称为空 / 超长 / 超过 20 项 / 数值超范围或小数位过多）',
    1002: 'Idea 不存在，或还没有效果复盘（先 idea review start）',
    1007: '当前状态不允许该操作（start：Idea 须为 planning/developing/released 且复盘未完成；complete：Idea 须为 released 且复盘为草稿；已完成的复盘不可再修改）',
    1009: '并发冲突（状态刚被他人改变），请重试',
    2000: '无权访问：你不是该 Idea 所属产品的组织成员',
};
/** Signed decimal, <= 4 places (trailing zeros don't count); blank = not available (null). */
function parseMetricValue(raw, label) {
    const text = raw.trim();
    if (text === '')
        return null;
    if (!/^-?[0-9]+(\.[0-9]+)?$/.test(text))
        throw new cliHelpers_1.InputError(`${label} 必须是数字（可为负，留空表示不可得），收到: ${raw}`);
    const [int, frac = ''] = text.replace('-', '').split('.');
    if (int.replace(/^0+(?=\d)/, '').length > MAX_INT_DIGITS)
        throw new cliHelpers_1.InputError(`${label} 超出范围（整数部分最多 ${MAX_INT_DIGITS} 位），收到: ${raw}`);
    if (frac.replace(/0+$/, '').length > METRIC_SCALE)
        throw new cliHelpers_1.InputError(`${label} 最多 ${METRIC_SCALE} 位小数，收到: ${raw}`);
    return Number(text);
}
/** `name[:expected[:actual[:unit]]]`; leave a part empty to mean "not available", e.g. `NPS:40::pts`. */
function parseMetric(raw) {
    const parts = raw.split(':');
    if (parts.length > 4) {
        throw new cliHelpers_1.InputError(`--metric 格式为 "name:expected:actual:unit"（后三段可省略，各段内不能含冒号），收到: ${raw}`);
    }
    const [name, expected = '', actual = '', unit = ''] = parts;
    return {
        name: (0, cliHelpers_1.requireText)(name, exports.MAX_METRIC_NAME, '--metric 的 name').trim(),
        expected: parseMetricValue(expected, '--metric 的 expected'),
        actual: parseMetricValue(actual, '--metric 的 actual'),
        unit: unit.trim() === '' ? null : (0, cliHelpers_1.checkMaxLength)(unit.trim(), exports.MAX_METRIC_UNIT, '--metric 的 unit'),
    };
}
exports.parseMetric = parseMetric;
/** `--metric` replaces the whole list (backend contract); `--clear-metrics` empties it; notes null = unchanged. */
function buildReviewUpdateBody(o) {
    const body = {};
    if (o.metric?.length && o.clearMetrics)
        throw new cliHelpers_1.InputError('--metric 与 --clear-metrics 不能同时使用');
    if (o.metric?.length) {
        if (o.metric.length > exports.MAX_METRICS)
            throw new cliHelpers_1.InputError(`--metric 最多 ${exports.MAX_METRICS} 项，当前 ${o.metric.length} 项`);
        body.metrics = o.metric.map(parseMetric);
    }
    else if (o.clearMetrics) {
        body.metrics = [];
    }
    if (o.notes !== undefined)
        body.notes = (0, cliHelpers_1.checkMaxLength)(o.notes, exports.MAX_NOTES, '--notes');
    if (Object.keys(body).length === 0)
        throw new cliHelpers_1.InputError('没有要修改的内容：至少指定 --metric / --clear-metrics / --notes 之一');
    return body;
}
exports.buildReviewUpdateBody = buildReviewUpdateBody;
//# sourceMappingURL=reviewInput.js.map
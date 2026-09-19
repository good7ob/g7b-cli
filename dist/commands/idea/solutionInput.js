"use strict";
/**
 * CLI-boundary validation for solution flags (IdeaSolutionCreateDto / IdeaSolutionUpdateDto +
 * IdeaSolutionEstimateDto). Ranges, decimal places and lengths mirror the backend's
 * IdeaSolutionFields so a bad value fails here instead of as a 1001 round-trip.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSolutionUpdateBody = exports.buildSolutionCreateBody = exports.parseKpi = exports.parseDecimal = exports.ESTIMATION_SOURCES = exports.LEVELS = void 0;
const cliHelpers_1 = require("../../utils/cliHelpers");
exports.LEVELS = ['low', 'medium', 'high'];
exports.ESTIMATION_SOURCES = ['manual', 'ai'];
const MAX_SOLUTION_NAME = 200;
const MAX_SOLUTION_NOTE = 500;
const MAX_EXPECTED_EFFECT = 2000;
const MAX_KPI_ITEMS = 20;
const MAX_KPI_NAME = 100;
const MAX_KPI_VALUE = 100;
const MAX_KPI_UNIT = 20;
/** flag -> [body field, decimal places, max] */
const NUMERIC_FIELDS = {
    effortFrontend: ['effortDaysFrontend', 1, 99999.9],
    effortBackend: ['effortDaysBackend', 1, 99999.9],
    effortAi: ['effortDaysAi', 1, 99999.9],
    effortTest: ['effortDaysTest', 1, 99999.9],
    effortPm: ['effortDaysPm', 1, 99999.9],
    cost: ['estimatedCost', 2, 9999999999.99],
    cloudCost: ['cloudCostMonthly', 2, 9999999999.99],
    tokenCost: ['aiTokenCostMonthly', 2, 9999999999.99],
    maintenanceCost: ['maintenanceCost', 2, 9999999999.99],
    cycleWeeks: ['cycleWeeks', 1, 999.9],
};
const FLAG_LABEL = (flag) => `--${flag.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
/** Non-negative decimal with at most `scale` places (trailing zeros don't count) and <= max. */
function parseDecimal(raw, label, scale, max) {
    const text = String(raw).trim();
    if (!/^[0-9]+(\.[0-9]+)?$/.test(text)) {
        throw new cliHelpers_1.InputError(`${label} 必须是非负数字，收到: ${raw}`);
    }
    const places = (text.split('.')[1] ?? '').replace(/0+$/, '').length;
    if (places > scale)
        throw new cliHelpers_1.InputError(`${label} 最多 ${scale} 位小数，收到: ${raw}`);
    const value = Number(text);
    if (value > max)
        throw new cliHelpers_1.InputError(`${label} 必须在 0 到 ${max} 之间，收到: ${raw}`);
    return value;
}
exports.parseDecimal = parseDecimal;
/** `name[:current[:target[:unit]]]` -> a KPI object with only the parts that were given. */
function parseKpi(raw) {
    const parts = raw.split(':').map((p) => p.trim());
    if (parts.length > 4) {
        throw new cliHelpers_1.InputError(`--kpi 格式为 "name:current:target:unit"（后三段可省略，各段内不能含冒号），收到: ${raw}`);
    }
    const [name, current, target, unit] = parts;
    const kpi = { name: (0, cliHelpers_1.requireText)(name, MAX_KPI_NAME, '--kpi 的 name') };
    if (current)
        kpi.current = (0, cliHelpers_1.checkMaxLength)(current, MAX_KPI_VALUE, '--kpi 的 current');
    if (target)
        kpi.target = (0, cliHelpers_1.checkMaxLength)(target, MAX_KPI_VALUE, '--kpi 的 target');
    if (unit)
        kpi.unit = (0, cliHelpers_1.checkMaxLength)(unit, MAX_KPI_UNIT, '--kpi 的 unit');
    return kpi;
}
exports.parseKpi = parseKpi;
function applyNotes(body, o) {
    if (o.description !== undefined)
        body.description = o.description;
    if (o.costNote !== undefined)
        body.costNote = (0, cliHelpers_1.checkMaxLength)(o.costNote, MAX_SOLUTION_NOTE, '--cost-note');
    if (o.cycleNote !== undefined)
        body.cycleNote = (0, cliHelpers_1.checkMaxLength)(o.cycleNote, MAX_SOLUTION_NOTE, '--cycle-note');
    if (o.effectNote !== undefined)
        body.expectedEffectNote = (0, cliHelpers_1.checkMaxLength)(o.effectNote, MAX_SOLUTION_NOTE, '--effect-note');
}
function applyEstimate(body, o) {
    Object.keys(NUMERIC_FIELDS).forEach((flag) => {
        const raw = o[flag];
        if (raw === undefined)
            return;
        const [field, scale, max] = NUMERIC_FIELDS[flag];
        body[field] = parseDecimal(raw, FLAG_LABEL(flag), scale, max);
    });
    if (o.technicalRisk !== undefined)
        body.technicalRisk = (0, cliHelpers_1.requireOneOf)(o.technicalRisk, exports.LEVELS, '--technical-risk');
    if (o.productRisk !== undefined)
        body.productRisk = (0, cliHelpers_1.requireOneOf)(o.productRisk, exports.LEVELS, '--product-risk');
    if (o.confidence !== undefined)
        body.confidence = (0, cliHelpers_1.requireOneOf)(o.confidence, exports.LEVELS, '--confidence');
    if (o.estimationSource !== undefined) {
        body.estimationSource = (0, cliHelpers_1.requireOneOf)(o.estimationSource, exports.ESTIMATION_SOURCES, '--estimation-source');
    }
    if (o.expectedEffect !== undefined) {
        body.expectedEffect = (0, cliHelpers_1.checkMaxLength)(o.expectedEffect, MAX_EXPECTED_EFFECT, '--expected-effect');
    }
    if (o.kpi?.length && o.clearKpi)
        throw new cliHelpers_1.InputError('--kpi 与 --clear-kpi 不能同时使用');
    if (o.kpi?.length) {
        if (o.kpi.length > MAX_KPI_ITEMS)
            throw new cliHelpers_1.InputError(`--kpi 最多 ${MAX_KPI_ITEMS} 项，当前 ${o.kpi.length} 项`);
        body.kpi = o.kpi.map(parseKpi);
    }
    else if (o.clearKpi) {
        body.kpi = [];
    }
}
function buildSolutionCreateBody(o) {
    const body = { name: (0, cliHelpers_1.requireText)(o.name, MAX_SOLUTION_NAME, '--name') };
    applyNotes(body, o);
    applyEstimate(body, o);
    return body;
}
exports.buildSolutionCreateBody = buildSolutionCreateBody;
/** Omitted flag = field unchanged (backend contract), so only send what was given. `--kpi` replaces the whole list. */
function buildSolutionUpdateBody(o) {
    const body = {};
    if (o.name !== undefined)
        body.name = (0, cliHelpers_1.requireText)(o.name, MAX_SOLUTION_NAME, '--name');
    applyNotes(body, o);
    applyEstimate(body, o);
    if (Object.keys(body).length === 0) {
        throw new cliHelpers_1.InputError('没有要修改的字段：至少指定 --name / --description / 备注 / 估算类参数（如 --effort-backend、--cost、--confidence、--kpi）之一');
    }
    return body;
}
exports.buildSolutionUpdateBody = buildSolutionUpdateBody;
//# sourceMappingURL=solutionInput.js.map
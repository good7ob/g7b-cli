"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerPackageUse = void 0;
const ApiClient_1 = __importDefault(require("../../services/ApiClient"));
const cliHelpers_1 = require("../../utils/cliHelpers");
const renderUse_1 = require("./renderUse");
const useFlags_1 = require("./useFlags");
const useInput_1 = require("./useInput");
/** `template package use`: instantiate every template of a package (in `sort_order`) in ONE transaction. */
function registerPackageUse(pkg) {
    (0, useFlags_1.withVarFlags)((0, useFlags_1.withTargetFlags)(pkg.command('use <packageId>')))
        .description('Instantiate a whole package into your product (all-or-nothing; not idempotent — check `template instances --package` before retrying)')
        .option('--item <templateId:name=value>', 'Override one variable of one template of the package, repeatable (the shared --var / --vars-file apply to every template that defines them)', cliHelpers_1.collect)
        .option('--json', 'Output as JSON')
        .action((packageId, o) => (0, cliHelpers_1.guarded)('实例化模板包失败', useInput_1.USE_ERROR_CODES, async () => {
        const pid = (0, cliHelpers_1.parseId)(packageId, 'packageId');
        const body = (0, useInput_1.buildPackageUseBody)(o);
        const result = await ApiClient_1.default
            .post(`/templates/packages/${pid}/instantiate`, body, useInput_1.INSTANTIATE_REQUEST)
            .catch((error) => {
            throw (0, cliHelpers_1.withTimeoutHint)(error, useInput_1.TIMEOUT_HINT);
        });
        (0, cliHelpers_1.emit)(o.json, result, () => (0, renderUse_1.renderPackageInstantiation)(result ?? {}));
    }));
}
exports.registerPackageUse = registerPackageUse;
//# sourceMappingURL=packageUseCommand.js.map
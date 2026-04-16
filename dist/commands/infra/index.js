"use strict";
/**
 * Infra Module CLI Commands
 *
 * Entry point for all infra-related CLI commands:
 * - infra app: Application portfolio management
 * - infra resource: Cloud resource management
 * - infra cost: Cost analysis and monitoring
 * - infra bill: Bill import and management
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerBillCommands = exports.registerCostCommands = exports.registerResourceCommands = exports.registerAppCommands = exports.registerInfraCommands = void 0;
const app_1 = require("./app");
Object.defineProperty(exports, "registerAppCommands", { enumerable: true, get: function () { return app_1.registerAppCommands; } });
const resource_1 = require("./resource");
Object.defineProperty(exports, "registerResourceCommands", { enumerable: true, get: function () { return resource_1.registerResourceCommands; } });
const cost_1 = require("./cost");
Object.defineProperty(exports, "registerCostCommands", { enumerable: true, get: function () { return cost_1.registerCostCommands; } });
const bill_1 = require("./bill");
Object.defineProperty(exports, "registerBillCommands", { enumerable: true, get: function () { return bill_1.registerBillCommands; } });
function registerInfraCommands(program) {
    const infraCommand = program
        .command('infra')
        .description('Manage cloud infrastructure, resources, costs, and billing');
    // Register sub-command groups
    (0, app_1.registerAppCommands)(infraCommand);
    (0, resource_1.registerResourceCommands)(infraCommand);
    (0, cost_1.registerCostCommands)(infraCommand);
    (0, bill_1.registerBillCommands)(infraCommand);
    return infraCommand;
}
exports.registerInfraCommands = registerInfraCommands;
//# sourceMappingURL=index.js.map
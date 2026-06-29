"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerQcCommands = void 0;
const bug_1 = require("./bug");
const report_1 = require("./report");
function registerQcCommands(program) {
    const qcCommand = program
        .command('qc')
        .description('质量控制 — Bug 追踪、质量报表');
    (0, bug_1.registerBugCommands)(qcCommand);
    (0, report_1.registerReportCommands)(qcCommand);
    return qcCommand;
}
exports.registerQcCommands = registerQcCommands;
//# sourceMappingURL=index.js.map
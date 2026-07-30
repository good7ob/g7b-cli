"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerPmCommands = void 0;
const project_1 = require("./project");
const task_1 = require("./task");
const workflow_1 = require("./workflow");
const report_1 = require("./report");
const tag_1 = require("./tag");
function registerPmCommands(program) {
    const pmCommand = program
        .command('pm')
        .description('Project management — projects, tasks, workflows, reports, tags');
    (0, project_1.registerProjectCommands)(pmCommand);
    (0, task_1.registerTaskCommands)(pmCommand);
    (0, workflow_1.registerWorkflowCommands)(pmCommand);
    (0, report_1.registerReportCommands)(pmCommand);
    (0, tag_1.registerTagCommands)(pmCommand);
    return pmCommand;
}
exports.registerPmCommands = registerPmCommands;
//# sourceMappingURL=index.js.map
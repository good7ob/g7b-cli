#!/usr/bin/env node
"use strict";
/**
 * good7ob CLI - Main Entry Point
 * Official command-line interface for the good7ob platform
 */
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const infra_1 = require("./commands/infra");
const pm_1 = require("./commands/pm");
const org_1 = require("./commands/org");
const content_1 = require("./commands/content");
const qc_1 = require("./commands/qc");
const config_1 = require("./commands/config");
const prd_1 = require("./commands/prd");
const req_1 = require("./commands/req");
const log_1 = require("./commands/log");
const case_1 = require("./commands/case");
const program = new commander_1.Command();
program
    .name('good7ob')
    .description('good7ob - Project management and cloud resource management CLI')
    .version('0.2.0');
// Register command groups
(0, infra_1.registerInfraCommands)(program);
(0, pm_1.registerPmCommands)(program);
(0, org_1.registerOrgCommands)(program);
(0, content_1.registerContentCommands)(program);
(0, qc_1.registerQcCommands)(program);
(0, config_1.registerConfigCommands)(program);
(0, prd_1.registerPrdCommands)(program);
(0, req_1.registerReqCommands)(program);
(0, log_1.registerLogCommands)(program);
(0, case_1.registerCaseCommands)(program);
// Parse command line arguments
program.parse(process.argv);
// Show help if no arguments provided
if (!process.argv.slice(2).length) {
    program.outputHelp();
}
//# sourceMappingURL=index.js.map
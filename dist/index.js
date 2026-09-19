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
const idea_1 = require("./commands/idea");
const workspace_1 = require("./commands/workspace");
const release_1 = require("./commands/release");
const approval_1 = require("./commands/approval");
const trace_1 = require("./commands/trace");
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
(0, idea_1.registerIdeaCommands)(program);
(0, workspace_1.registerWorkspaceCommands)(program);
(0, release_1.registerReleaseCommands)(program);
(0, approval_1.registerApprovalCommands)(program);
(0, trace_1.registerTraceCommands)(program);
// Called after the groups are registered so it only affects the root: without it the root
// swallows a `--version` given after a subcommand (`release create --version 1.2.0` would
// print the CLI version and exit). `good7ob --version` / `-V` still work.
program.enablePositionalOptions();
// Parse command line arguments
program.parse(process.argv);
// Show help if no arguments provided
if (!process.argv.slice(2).length) {
    program.outputHelp();
}
//# sourceMappingURL=index.js.map
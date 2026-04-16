#!/usr/bin/env node
"use strict";
/**
 * good7ob CLI - Main Entry Point
 * Official command-line interface for the good7ob platform
 */
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const infra_1 = require("./commands/infra");
const program = new commander_1.Command();
program
    .name('good7ob')
    .description('good7ob - Project management and cloud resource management CLI')
    .version('0.1.0');
// Register command groups
(0, infra_1.registerInfraCommands)(program);
// Parse command line arguments
program.parse(process.argv);
// Show help if no arguments provided
if (!process.argv.slice(2).length) {
    program.outputHelp();
}
//# sourceMappingURL=index.js.map
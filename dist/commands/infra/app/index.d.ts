/**
 * Application Portfolio Management Commands
 *
 * Subcommands:
 * - infra app create: Create a new application
 * - infra app update: Update application information
 * - infra app delete: Delete an application
 * - infra app get: Get application details
 * - infra app list: List all applications
 * - infra app import: Batch import applications from CSV
 * - infra app export: Export application inventory
 * - infra app tag: Manage application tags
 * - infra app bind-resource: Associate resources to application
 * - infra app unbind-resource: Remove resource association
 * - infra app auto-bind: Configure automatic resource association rules
 * - infra app health-check: Perform application inventory health check
 */
import { Command } from 'commander';
export declare function registerAppCommands(infraCommand: Command): Command;
//# sourceMappingURL=index.d.ts.map
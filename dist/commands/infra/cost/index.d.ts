/**
 * Cost Analysis and Monitoring Commands
 *
 * Subcommands:
 * - infra cost overview: Cost summary for a month
 * - infra cost app: Cost breakdown by application
 * - infra cost env: Cost breakdown by environment
 * - infra cost type: Cost breakdown by resource type
 * - infra cost provider: Cost breakdown by cloud provider
 * - infra cost trend: Cost trends over time
 * - infra cost waste: Identify waste and low-utilization resources
 * - infra cost reconcile: Reconcile costs against bills
 * - infra cost export: Export cost report
 * - infra cost forecast: Forecast monthly costs based on trends
 */
import { Command } from 'commander';
export declare function registerCostCommands(infraCommand: Command): Command;
//# sourceMappingURL=index.d.ts.map
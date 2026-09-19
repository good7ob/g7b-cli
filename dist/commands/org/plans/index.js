"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerPlanCommands = void 0;
const ApiClient_1 = __importDefault(require("../../../services/ApiClient"));
const extractRecords_1 = require("../../../utils/extractRecords");
/** Not to be confused with `pm plan` (AI-agent execution plans, a different domain) —
 *  these are org-lead-assigned next-day/weekly/monthly plans for a member (human or
 *  AI employee), linking existing pm_task rows.
 */
function parseTaskIds(input) {
    return input
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map((s) => {
        const n = parseInt(s, 10);
        if (isNaN(n)) {
            throw new Error(`Invalid task ID in list: "${s}"`);
        }
        return n;
    });
}
function registerPlanCommands(orgCommand) {
    // list plans
    orgCommand
        .command('plans <org-id>')
        .description('List next-day/weekly/monthly member plans (次日/周/月计划)')
        .requiredOption('--plan-type <type>', 'DAILY, WEEKLY, or MONTHLY')
        .requiredOption('--period-start <date>', 'Any date within the target period (YYYY-MM-DD); server normalizes it to the period start')
        .option('--member-type <type>', 'Filter by member type (HUMAN|AGENT)')
        .option('--member-ref-id <id>', 'Filter by member (platform userId for HUMAN, org_ai_employees.id for AGENT)')
        .option('--json', 'Output as JSON')
        .option('--csv', 'Output as CSV')
        .action(async (orgId, options) => {
        try {
            const params = {
                planType: options.planType,
                periodStart: options.periodStart,
            };
            if (options.memberType)
                params.memberType = options.memberType;
            if (options.memberRefId)
                params.memberRefId = parseInt(options.memberRefId, 10);
            const result = await ApiClient_1.default.get(`/progress/org/${orgId}/plans`, params);
            const records = (0, extractRecords_1.extractRecords)(result);
            if (options.json) {
                console.log(JSON.stringify(result, null, 2));
                return;
            }
            if (options.csv) {
                console.log('ID,MemberType,MemberName,PlanType,PeriodStart,PeriodEnd,Title,TaskCount,CompletedTaskCount');
                records.forEach((p) => {
                    console.log(`${p.id},${p.memberType},"${p.memberName}",${p.planType},${p.periodStartDate},${p.periodEndDate},"${p.title || ''}",${p.taskCount},${p.completedTaskCount}`);
                });
                return;
            }
            if (!records.length) {
                console.log('No plans found for this filter.');
                return;
            }
            console.log(`\n计划列表 — 组织 ${orgId}`);
            console.log('─'.repeat(90));
            console.log('ID'.padEnd(8) +
                '成员'.padEnd(20) +
                '类型'.padEnd(10) +
                '周期'.padEnd(24) +
                '完成度'.padEnd(10) +
                '标题');
            console.log('─'.repeat(90));
            records.forEach((p) => {
                const memberLabel = `${p.memberName}${p.memberType === 'AGENT' ? ' (AI)' : ''}`;
                const period = `${p.periodStartDate} ~ ${p.periodEndDate}`;
                const completion = `${p.completedTaskCount}/${p.taskCount}`;
                console.log(String(p.id).padEnd(8) +
                    memberLabel.substring(0, 18).padEnd(20) +
                    (p.planType || '-').padEnd(10) +
                    period.padEnd(24) +
                    completion.padEnd(10) +
                    (p.title || '-'));
            });
            console.log('─'.repeat(90));
        }
        catch (error) {
            console.error('✗ 获取计划列表失败:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
    // create plan
    orgCommand
        .command('create-plan <org-id>')
        .description('Assign a next-day/weekly/monthly plan to a member, linking existing tasks')
        .requiredOption('--member-type <type>', 'HUMAN or AGENT')
        .requiredOption('--member-ref-id <id>', 'Platform userId for HUMAN, org_ai_employees.id for AGENT')
        .requiredOption('--plan-type <type>', 'DAILY, WEEKLY, or MONTHLY')
        .requiredOption('--period-start <date>', 'Any date within the target period (YYYY-MM-DD); server normalizes it to the period start')
        .option('--title <text>', 'Optional free-text label')
        .option('--task-ids <ids>', 'Comma-separated pm_task IDs to link into this plan')
        .option('--json', 'Output result as JSON')
        .action(async (orgId, options) => {
        try {
            const body = {
                memberType: options.memberType,
                memberRefId: parseInt(options.memberRefId, 10),
                planType: options.planType,
                periodStartDate: options.periodStart,
            };
            if (options.title)
                body.title = options.title;
            body.taskIds = options.taskIds ? parseTaskIds(options.taskIds) : [];
            const plan = await ApiClient_1.default.post(`/progress/org/${orgId}/plans`, body);
            if (options.json) {
                console.log(JSON.stringify(plan, null, 2));
                return;
            }
            console.log(`✓ 计划已创建: [${plan?.id || ''}] ${options.planType} ${plan?.periodStartDate || ''} ~ ${plan?.periodEndDate || ''}`);
        }
        catch (error) {
            console.error('✗ 创建计划失败:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
    // update plan
    orgCommand
        .command('update-plan <org-id> <plan-id>')
        .description("Update a plan's title and/or linked task set — each is only touched if its flag is passed")
        .option('--title <text>', 'Optional free-text label (pass --title "" to clear it)')
        .option('--task-ids <ids>', 'Comma-separated pm_task IDs — full replacement set (pass --task-ids "" to clear all)')
        .option('--json', 'Output result as JSON')
        .action(async (orgId, planId, options) => {
        try {
            const body = {};
            if (options.title !== undefined)
                body.title = options.title;
            if (options.taskIds !== undefined)
                body.taskIds = parseTaskIds(options.taskIds);
            const plan = await ApiClient_1.default.patch(`/progress/org/${orgId}/plans/${planId}`, body);
            if (options.json) {
                console.log(JSON.stringify(plan, null, 2));
                return;
            }
            console.log(`✓ 计划已更新: ${planId}`);
        }
        catch (error) {
            console.error('✗ 更新计划失败:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
}
exports.registerPlanCommands = registerPlanCommands;
//# sourceMappingURL=index.js.map
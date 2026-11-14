import { Command } from 'commander';
import apiClient from '../../../services/ApiClient';
import { extractRecords } from '../../../utils/extractRecords';
import { currentProjectId } from '../../../utils/resolveProjectId';
import { planMove } from './movePlan';
import { registerDepCommands } from './dep';
import { registerTimeCommands } from './time';
import { describeSpawnContextError, linkFields, renderSpawnResult, runContextHeaders } from './spawn';
import { describeTemplateReject, printWarnings, templateFields } from './templateReject';
import { prdOption, registerRequirementCommands, resolveSources, upsertSources } from './requirement';
import { fmtDate, fmtDateTime, InputError, parseDate, parseId } from '../../../utils/cliHelpers';
import {
  checkUpdateTagOptions,
  collectTagList,
  createTagFields,
  currentTagNames,
  listTagParam,
  mergeTagNames,
  needsCurrentTags,
  normalizeTagNames,
  updateTagFields,
} from './tagInput';

function plannedDates(options: { plannedStartDate?: string; plannedEndDate?: string }): Record<string, string> {
  const dates: Record<string, string> = {};
  if (options.plannedStartDate !== undefined) dates.plannedStartDate = parseDate(options.plannedStartDate, '--planned-start-date');
  if (options.plannedEndDate !== undefined) dates.plannedEndDate = parseDate(options.plannedEndDate, '--planned-end-date');
  if (dates.plannedStartDate && dates.plannedEndDate && dates.plannedEndDate < dates.plannedStartDate) {
    throw new InputError('--planned-end-date 不能早于 --planned-start-date');
  }
  return dates;
}

const EXECUTOR_TYPES = ['HUMAN', 'AGENT'];

/** Statuses shown in `--status` help (idea #210 adds awaiting_completion_approval = 完成待验收). */
const STATUS_HELP =
  'not_started|in_progress|completed|awaiting_completion_approval|blocked|cancelled|on_hold';

/** Printed when a completion was stored as awaiting_completion_approval (idea #210). */
export const ACCEPTANCE_SUBMITTED = '已提交验收（完成待验收），等待在成果验证中通过';

const MAX_REASON = 500;

/**
 * `--skip-acceptance --reason <text>` → the update body fields (idea #210 R3). Only meaningful together with
 * `--status completed`; the server decides who may skip (task owner only, never an AI employee).
 */
export function skipAcceptanceFields(options: {
  skipAcceptance?: boolean;
  reason?: string;
  status?: string;
}): Record<string, unknown> {
  if (!options.skipAcceptance) {
    if (options.reason !== undefined) throw new InputError('--reason 只能与 --skip-acceptance 一起使用');
    return {};
  }
  if (options.status !== 'completed') {
    throw new InputError('--skip-acceptance 需要同时指定 --status completed');
  }
  const reason = (options.reason ?? '').trim();
  if (!reason) throw new InputError('--skip-acceptance 需要用 --reason 写明理由（如「已人工验证」）');
  if (reason.length > MAX_REASON) throw new InputError(`--reason 不能超过 ${MAX_REASON} 字`);
  return { skipAcceptance: true, skipAcceptanceReason: reason };
}

/** Whether the server routed a requested completion to acceptance (flag, or a different stored status). */
export function wentToAcceptance(task: any, requestedStatus?: string): boolean {
  if (task?.acceptanceRequired === true) return true;
  return requestedStatus === 'completed' && task?.status === 'awaiting_completion_approval';
}

/**
 * An AI employee only owns a task whose executor is AGENT + `emp:<employeeId>` (prd-0089 rp-ws-ai-0002),
 * so `--ai-employee 5` is the short form of `--executor-type AGENT --executor-id emp:5`.
 */
export function executorFields(options: {
  aiEmployee?: string;
  executorType?: string;
  executorId?: string;
}): Record<string, string> {
  if (options.aiEmployee !== undefined) {
    if (options.executorType !== undefined || options.executorId !== undefined) {
      throw new InputError('--ai-employee 不能与 --executor-type / --executor-id 同时使用');
    }
    return { executorType: 'AGENT', executorId: `emp:${parseId(options.aiEmployee, '--ai-employee')}` };
  }
  if (options.executorType === undefined) {
    if (options.executorId !== undefined) throw new InputError('--executor-id 需要同时指定 --executor-type');
    return {};
  }
  const executorType = options.executorType.trim().toUpperCase();
  if (!EXECUTOR_TYPES.includes(executorType)) {
    throw new InputError(`--executor-type 只能是 ${EXECUTOR_TYPES.join('|')}，收到: ${options.executorType}`);
  }
  if (options.executorId === undefined) return { executorType };
  const raw = options.executorId.trim();
  if (executorType === 'HUMAN') {
    return { executorType, executorId: String(parseId(raw, '--executor-id')) };
  }
  // A bare number is an AI employee id; other agent ids (e.g. hermes-v1) pass through unchanged.
  const employee = /^(?:emp:)?([0-9]+)$/.exec(raw);
  if (employee) return { executorType, executorId: `emp:${parseId(employee[1], '--executor-id')}` };
  if (!raw) throw new InputError('--executor-id 不能为空');
  return { executorType, executorId: raw };
}

export function registerTaskCommands(pmCommand: Command) {
  const taskCommand = pmCommand
    .command('task')
    .description('Task management — create, update, list, batch update');

  taskCommand
    .command('list [project-id]')
    .description('List tasks in a project')
    .option('--status <status>', `Filter by status (${STATUS_HELP})`)
    .option('--include-on-hold', 'Include on_hold tasks (hidden by default; --status on_hold also shows them)')
    .option('--priority <priority>', 'Filter by priority (high|medium|low)')
    .option('--tags <tags>', 'Filter by tag names (comma-separated; a task matching any of them is listed)')
    .option('--tag <name>', 'Filter by tag name (repeatable or comma-separated; same as --tags)', collectTagList, [])
    .option('--parent-task-id <id>', 'List sub-tasks of a parent task')
    .option('--sort <field>', 'Sort field', 'createdAt')
    .option('--order <direction>', 'Sort direction (asc|desc)', 'desc')
    .option('--json', 'Output as JSON')
    .option('--csv', 'Output as CSV')
    .action(async (projectArg, options) => {
      try {
        const projectId = currentProjectId(projectArg);
        const params: any = { sort: options.sort, order: options.order };
        if (options.status) params.status = options.status;
        // on_hold tasks are ignored unless asked for
        params.includeOnHold = Boolean(options.includeOnHold) || options.status === 'on_hold';
        if (options.priority) params.priority = options.priority;
        const tags = listTagParam(options);
        if (tags) params.tags = tags;
        if (options.parentTaskId) params.parentTaskId = options.parentTaskId;

        const result = await apiClient.get(`/progress/projects/${projectId}/tasks`, params);
        // fix: #4 https://github.com/good7ob/g7b-cli/issues/4
        const records = extractRecords(result);

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        if (options.csv) {
          console.log('ID,Name,Status,Priority,Owner,Deadline');
          records.forEach((t: any) => {
            console.log(`${t.id},${t.name},${t.status},${t.priority || ''},${t.ownerName || ''},${fmtDate(t.deadline, '')}`);
          });
          return;
        }

        if (!records.length) {
          console.log('No tasks found.');
          return;
        }

        console.log(`\n任务列表 — 项目 ${projectId}`);
        console.log('─'.repeat(95));
        console.log(
          'ID'.padEnd(8) +
          '任务名称'.padEnd(30) +
          '状态'.padEnd(14) +
          '优先级'.padEnd(10) +
          '负责人'.padEnd(16) +
          '截止日期'
        );
        console.log('─'.repeat(95));
        records.forEach((t: any) => {
          console.log(
            String(t.id).padEnd(8) +
            (t.name || '').substring(0, 28).padEnd(30) +
            (t.status || '').padEnd(14) +
            (t.priority || '-').padEnd(10) +
            (t.ownerName || '-').padEnd(16) +
            fmtDate(t.deadline, '-')
          );
        });
        console.log('─'.repeat(95));
        console.log(`共 ${records.length} 条任务`);
      } catch (error) {
        console.error('✗ 获取任务列表失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  taskCommand
    .command('get <id>')
    .description('Get task details')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      try {
        const task = await apiClient.get(`/progress/tasks/${id}`);
        if (options.json) {
          console.log(JSON.stringify(task, null, 2));
          return;
        }
        console.log('\n任务详情');
        console.log('─'.repeat(50));
        console.log(`ID:         ${task.id}`);
        console.log(`名称:       ${task.name}`);
        console.log(`状态:       ${task.status}`);
        console.log(`优先级:     ${task.priority || '-'}`);
        console.log(`描述:       ${task.description || '-'}`);
        console.log(`负责人:     ${task.ownerName || task.ownerId || '-'}`);
        console.log(`截止日期:   ${fmtDate(task.deadline, '-')}`);
        console.log(`计划开始:   ${fmtDate(task.plannedStartDate, '-')}`);
        console.log(`预计完成:   ${fmtDate(task.plannedEndDate, '-')}`);
        console.log(`父任务ID:   ${task.parentTaskId || '-'}`);
        console.log(`项目ID:     ${task.projectId}`);
        console.log(`执行者类型: ${task.executorType || '-'}`);
        console.log(`执行者:     ${task.executorId || '-'}`);
        console.log(`阻塞原因:   ${task.blockedReason || '-'}`);
        console.log(`创建时间:   ${fmtDateTime(task.createdAt, '-')}`);
        if (task.requirementRemovedAt) {
          console.log(`⚠ 需求已移除: ${task.requirementRemovedNote || '-'}（${fmtDateTime(task.requirementRemovedAt, '-')}）`);
        }
        if (task.requirementChangedAt) {
          console.log(`⚠ 需求已变更: ${task.requirementChangedNote || '-'}（${fmtDateTime(task.requirementChangedAt, '-')}）`);
        }
        if (task.requirementRemovedAt || task.requirementChangedAt) {
          console.log('  先 `pm task requirement-check` 看变化，处理后 `pm task requirement-ack`');
        }
        if (task.tags?.length) {
          console.log(`标签:       ${task.tags.map((t: any) => t.name || t).join(', ')}`);
        }
        if (task.subTasks?.length) {
          console.log(`子任务数:   ${task.subTasks.length}`);
        }
        console.log('─'.repeat(50));
      } catch (error) {
        console.error('✗ 获取任务详情失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // commander cannot tell `--template 9 --no-template` apart from either alone: record which flags appeared
  const templateSeen = { template: false, noTemplate: false };
  const createCommand = taskCommand
    .command('create')
    .description('Create a new task')
    .option('--project-id <id>', 'Project ID (default: current project)')
    .requiredOption('--name <name>', 'Task name')
    .option('--description <desc>', 'Task description')
    .option(...prdOption)
    .option('--priority <priority>', 'Priority (high|medium|low)', 'medium')
    .option('--status <status>', 'Initial status', 'not_started')
    .option('--deadline <date>', 'Deadline (YYYY-MM-DD)')
    .option('--planned-start-date <date>', 'Planned start date (YYYY-MM-DD)')
    .option('--planned-end-date <date>', 'Expected completion / planned end date (YYYY-MM-DD)')
    .option('--owner-id <id>', 'Owner user ID')
    .option('--parent-task-id <id>', 'Parent task ID (for sub-tasks)')
    .option('--estimated-hours <hours>', 'Estimated hours')
    .option('--ai-employee <id>', 'Hand the task to this AI employee (executor AGENT, emp:<id>)')
    .option('--executor-type <type>', 'Executor type (HUMAN|AGENT)')
    .option('--executor-id <id>', 'Executor: user ID for HUMAN; AI employee ID / emp:<id> or agent id for AGENT')
    .option('--tag <name>', 'Tag name (repeatable or comma-separated); a name you do not have yet is created as your tag', collectTagList, [])
    .option('--tag-id <id>', 'Tag ID (repeatable or comma-separated; see `pm tag list`); not with --tag', collectTagList, [])
    .option('--fp-id <id>', 'Function point ID to link (AI self-built tasks in a window-loop run; sent as functionPointId)')
    .option('--rp-id <id>', 'Rule point ID to link (sent as rulePointId)')
    .option('--run-id <id>', 'Automation run ID (X-Automation-Run-Id; with --step-id; sent as given). Default: the step `agent listen` holds, only when its run is a window-loop long run')
    .option('--step-id <id>', 'Automation step ID (X-Automation-Step-Id; with --run-id)')
    .option('--no-run-context', 'Do not look up or send the run context, even when `agent listen` holds a step')
    .option('--template <id>', 'Use another task template than the effective one (sent as templateId; refused where a template is enforced)')
    .option('--no-template', 'Create without a template (sent as noTemplate; refused where a template is enforced; not with --template)')
    .option('--json', 'Output result as JSON')
    .action(async (options) => {
      try {
        const body: any = {
          ...templateFields(options, templateSeen),
          ...createTagFields(options),
          ...linkFields(options),
          projectId: currentProjectId(options.projectId),
          name: options.name,
          priority: options.priority,
          status: options.status,
          ...plannedDates(options),
          ...executorFields(options),
        };
        if (options.description) body.description = options.description;
        if (options.prd?.length) body.description = upsertSources(options.description, await resolveSources(options.prd));
        if (options.deadline) body.deadline = options.deadline;
        if (options.ownerId) body.ownerId = parseInt(options.ownerId);
        if (options.parentTaskId) body.parentTaskId = parseInt(options.parentTaskId);
        if (options.estimatedHours) body.estimatedHours = parseFloat(options.estimatedHours);

        const headers = await runContextHeaders(options);
        const task = headers
          ? await apiClient.post('/progress/tasks', body, { headers })
          : await apiClient.post('/progress/tasks', body);
        if (options.json) {
          console.log(JSON.stringify(task, null, 2));
          return;
        }
        const spawned = renderSpawnResult(task, options.name);
        if (spawned) {
          console.log(spawned);
          printWarnings(task);
          return;
        }
        const tagNames = currentTagNames(task);
        console.log(`✓ 任务已创建: [${task?.id || ''}] ${options.name}${tagNames.length ? `（标签: ${tagNames.join(', ')}）` : ''}`);
        printWarnings(task);
      } catch (error) {
        const rejected = describeTemplateReject(error);
        if (rejected) {
          console.error(`✗ ${rejected}`);
        } else {
          const spawnError = describeSpawnContextError(error);
          console.error('✗ 创建任务失败:', spawnError ?? (error instanceof Error ? error.message : String(error)));
        }
        process.exit(1);
      }
    });
  createCommand.on('option:template', () => { templateSeen.template = true; });
  createCommand.on('option:no-template', () => { templateSeen.noTemplate = true; });

  taskCommand
    .command('update <id>')
    .description('Update a task')
    .option('--name <name>', 'Task name')
    .option('--description <desc>', 'Task description')
    .option(...prdOption)
    .option('--priority <priority>', 'Priority (high|medium|low)')
    .option(
      '--status <status>',
      `Status (${STATUS_HELP}). In a product-linked project, completing an AI-implemented task stores ` +
        'awaiting_completion_approval (完成待验收) until it is accepted on the product\'s 成果验证 tab'
    )
    .option('--skip-acceptance', 'With --status completed: complete without acceptance (task owner only, needs --reason)')
    .option('--reason <text>', 'Why acceptance is skipped (1-500 chars, e.g. 已人工验证)')
    .option('--json', 'Output the updated task as JSON')
    .option('--deadline <date>', 'Deadline (YYYY-MM-DD)')
    .option('--planned-start-date <date>', 'Planned start date (YYYY-MM-DD)')
    .option('--planned-end-date <date>', 'Expected completion / planned end date (YYYY-MM-DD)')
    .option('--owner-id <id>', 'Owner user ID')
    .option('--parent-task-id <id>', 'Parent task ID')
    .option('--project-id <id>', 'Move the task to another project (no pre-flight checks — prefer `pm task move`)')
    .option('--estimated-hours <hours>', 'Estimated hours')
    .option('--actual-hours <hours>', 'Actual hours spent')
    .option('--ai-employee <id>', 'Hand the task to this AI employee (executor AGENT, emp:<id>)')
    .option('--executor-type <type>', 'Executor type (HUMAN|AGENT)')
    .option('--executor-id <id>', 'Executor: user ID for HUMAN; AI employee ID / emp:<id> or agent id for AGENT')
    .option('--tag <name>', 'Replace ALL tags with these names (repeatable or comma-separated; missing ones are created)', collectTagList, [])
    .option('--tag-id <id>', 'Replace ALL tags with these tag IDs (repeatable or comma-separated)', collectTagList, [])
    .option('--add-tag <name>', 'Add a tag, keeping the others (repeatable or comma-separated; created if missing)', collectTagList, [])
    .option('--remove-tag <name>', 'Remove a tag, keeping the others (repeatable or comma-separated)', collectTagList, [])
    .option('--clear-tags', 'Remove all tags from the task')
    .action(async (id, options) => {
      try {
        checkUpdateTagOptions(options);
        const body: any = { ...plannedDates(options), ...executorFields(options), ...skipAcceptanceFields(options) };
        let current: any;
        const currentTask = async () => (current ??= await apiClient.get(`/progress/tasks/${id}`));
        if (options.name) body.name = options.name;
        if (options.description) body.description = options.description;
        if (options.prd?.length) {
          // without --description the source lines go into the description the task has now
          const base = options.description ?? (await currentTask()).description;
          body.description = upsertSources(base, await resolveSources(options.prd));
        }
        // idea #245: a PUT with tags replaces the whole set, so add/remove start from the tags the task has now
        const tagFields = updateTagFields(
          options,
          needsCurrentTags(options) ? currentTagNames(await currentTask()) : undefined
        );
        if (options.priority) body.priority = options.priority;
        if (options.status) body.status = options.status;
        if (options.deadline) body.deadline = options.deadline;
        if (options.ownerId) body.ownerId = parseInt(options.ownerId);
        if (options.parentTaskId) body.parentTaskId = parseInt(options.parentTaskId);
        if (options.projectId) body.projectId = parseInt(options.projectId);
        // g7b #1093 - MCP update_task already had this field in its schema; the CLI's
        // `pm task update` never exposed it, so add the matching numeric option here.
        if (options.estimatedHours) body.estimatedHours = parseFloat(options.estimatedHours);
        if (options.actualHours) body.actualHours = parseFloat(options.actualHours);
        if (tagFields === null && !Object.keys(body).length) {
          // only --add-tag / --remove-tag, and the task already has exactly that set: nothing to write
          if (options.json) console.log(JSON.stringify(current, null, 2));
          else console.log(`✓ 任务 ${id} 的标签无变化: ${currentTagNames(current).join(', ') || '（无）'}`);
          return;
        }
        Object.assign(body, tagFields);

        const task = await apiClient.put(`/progress/tasks/${id}`, body);
        if (options.json) {
          console.log(JSON.stringify(task, null, 2));
          return;
        }
        const tagNote = tagFields && (tagFields.tags || tagFields.tagIds)
          ? `（标签: ${tagFields.tags ? tagFields.tags.join(', ') : tagFields.tagIds!.length ? `ID ${tagFields.tagIds!.join(', ')}` : '已清空'}）`
          : '';
        if (wentToAcceptance(task, options.status)) {
          console.log(`✓ ${ACCEPTANCE_SUBMITTED}: ${id}${tagNote}`);
        } else {
          console.log(`✓ 任务已更新: ${id}${tagNote}`);
        }
      } catch (error) {
        console.error('✗ 更新任务失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  taskCommand
    .command('move <ids...>')
    .description('Move one or more tasks to another project (comma- or space-separated IDs)')
    .requiredOption('--to-project <id>', 'Target project ID')
    .option('--with-subtasks', 'Move each task’s sub-tasks along with it')
    .option('--force', 'Proceed despite validation errors')
    .option('--dry-run', 'Show the plan without writing anything')
    .option('--json', 'Output the plan and result as JSON')
    .action(async (ids: string[], options) => {
      try {
        const taskIds = Array.from(
          new Set(
            ids
              .flatMap((v) => String(v).split(','))
              .map((v) => v.trim())
              .filter(Boolean)
              .map((v) => parseInt(v, 10))
          )
        );
        if (taskIds.some((v) => Number.isNaN(v))) {
          throw new Error('任务 ID 必须是数字');
        }

        const targetId = parseInt(options.toProject, 10);
        const target = await apiClient.get(`/progress/projects/${targetId}`);
        if (!target?.id) {
          throw new Error(`目标项目 ${targetId} 不存在`);
        }

        const fetched = new Map<number, any>();
        const fetchTask = async (id: number) => {
          if (!fetched.has(id)) fetched.set(id, await apiClient.get(`/progress/tasks/${id}`));
          return fetched.get(id);
        };

        let tasks = await Promise.all(taskIds.map(fetchTask));
        const missing = taskIds.filter((id, i) => !tasks[i]?.id);
        if (missing.length) {
          throw new Error(`任务不存在: ${missing.join(', ')}`);
        }

        // GET /progress/tasks/{id} does not populate subTasks, so children have
        // to be looked up through the project task list.
        const attachSubTasks = async (task: any) => {
          const result = await apiClient.get(`/progress/projects/${task.projectId}/tasks`, {
            parentTaskId: task.id,
          });
          // fix: #4 https://github.com/good7ob/g7b-cli/issues/4
          const children = extractRecords(result);
          children.forEach((c: any) => fetched.set(c.id, c));
          return { ...task, subTasks: children.map((c: any) => ({ id: c.id })) };
        };

        tasks = await Promise.all(tasks.map(attachSubTasks));

        if (options.withSubtasks) {
          // Descend until no new descendant shows up, so deep trees move whole.
          const collected = new Map<number, any>(tasks.map((t: any) => [t.id, t]));
          let frontier = tasks;
          while (frontier.length) {
            const next: any[] = [];
            for (const parent of frontier) {
              for (const ref of parent.subTasks || []) {
                if (collected.has(ref.id)) continue;
                const child = await attachSubTasks(await fetchTask(ref.id));
                collected.set(child.id, child);
                next.push(child);
              }
            }
            frontier = next;
          }
          tasks = Array.from(collected.values());
        }

        // Resolve the project of any parent that is not part of this batch, so
        // planMove can tell "parent already lives in the target" from "parent
        // would be left behind".
        const movingIds = new Set(tasks.map((t: any) => t.id));
        const parentProjectIds: Record<number, number> = {};
        for (const parentId of new Set(
          tasks.map((t: any) => t.parentTaskId).filter((p: any) => p && !movingIds.has(p))
        )) {
          const parent = await fetchTask(parentId as number);
          if (parent?.projectId != null) parentProjectIds[parentId as number] = parent.projectId;
        }

        const plan = planMove(tasks, target, {
          force: options.force,
          parentProjectIds,
        });

        if (options.json) {
          console.log(JSON.stringify({ target: { id: target.id, name: target.name }, ...plan }, null, 2));
        } else {
          console.log(`\n移动计划 → 项目 ${target.id} ${target.name || ''}`);
          console.log('─'.repeat(70));
          plan.moves.forEach((m) => console.log(`  移动  ${m.taskId}  ${m.name}  (原项目 ${m.fromProjectId})`));
          plan.issues.forEach((i) =>
            console.log(`  ${i.level === 'error' ? '✗ 错误' : '! 警告'}  ${i.message}`)
          );
          if (!plan.moves.length && !plan.issues.length) console.log('  没有需要移动的任务');
          console.log('─'.repeat(70));
        }

        if (plan.blocked) {
          console.error('✗ 存在阻断性问题，未做任何写入。修正后重试，或加 --force 强制执行。');
          process.exit(1);
        }

        if (options.dryRun) {
          if (!options.json) console.log('（--dry-run，未写入）');
          return;
        }

        for (const m of plan.moves) {
          await apiClient.put(`/progress/tasks/${m.taskId}`, { projectId: target.id });
        }

        // The backend returns the pre-save entity on some paths, so verify by
        // reading each task back instead of trusting the write response.
        const verified: any[] = [];
        for (const m of plan.moves) {
          const after = await apiClient.get(`/progress/tasks/${m.taskId}`);
          verified.push({ taskId: m.taskId, projectId: after?.projectId, ok: after?.projectId === target.id });
        }

        if (options.json) {
          console.log(JSON.stringify({ verified }, null, 2));
        } else {
          verified.forEach((v) =>
            console.log(v.ok ? `✓ 任务 ${v.taskId} 已移动到项目 ${target.id}` : `✗ 任务 ${v.taskId} 移动未生效（当前项目 ${v.projectId}）`)
          );
        }
        if (verified.some((v) => !v.ok)) process.exit(1);
      } catch (error) {
        console.error('✗ 移动任务失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  taskCommand
    .command('delete <id>')
    .description('Delete a task')
    .option('-f, --force', 'Skip confirmation prompt')
    .action(async (id, options) => {
      try {
        if (!options.force) {
          console.log(`⚠ 即将删除任务 ${id}，使用 -f/--force 确认删除`);
          process.exit(0);
        }
        await apiClient.delete(`/progress/tasks/${id}`);
        console.log(`✓ 任务已删除: ${id}`);
      } catch (error) {
        console.error('✗ 删除任务失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  taskCommand
    .command('submit-acceptance <id>')
    .description('提交验收：进行中 → 完成待验收（awaiting_completion_approval），在产品「成果验证」中由人通过 / 退回')
    .option('--summary <text>', 'What was delivered, for the verifier (≤ 500 chars)')
    .option('--json', 'Output the task as JSON')
    .action(async (idArg, options) => {
      try {
        const id = parseId(idArg, '<id>');
        const body: Record<string, string> = {};
        if (options.summary !== undefined) {
          const summary = String(options.summary).trim();
          if (summary.length > MAX_REASON) throw new InputError(`--summary 不能超过 ${MAX_REASON} 字`);
          if (summary) body.summary = summary;
        }
        const task = await apiClient.post(`/progress/tasks/${id}/submit-acceptance`, body);
        if (options.json) {
          console.log(JSON.stringify(task, null, 2));
          return;
        }
        console.log(`✓ ${ACCEPTANCE_SUBMITTED}: ${id}`);
      } catch (error) {
        console.error('✗ 提交验收失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  taskCommand
    .command('batch-update')
    .description('Batch update multiple tasks')
    .requiredOption('--ids <ids>', 'Comma-separated task IDs')
    .option('--status <status>', `New status for all tasks (${STATUS_HELP})`)
    .option('--priority <priority>', 'New priority for all tasks')
    .option('--owner-id <id>', 'New owner for all tasks')
    .option('--skip-acceptance', 'With --status completed: complete without acceptance (task owner only, needs --reason)')
    .option('--reason <text>', 'Why acceptance is skipped (1-500 chars)')
    .option('--add-tag <name>', 'Add a tag to every task, keeping their other tags (repeatable or comma-separated)', collectTagList, [])
    .option('--remove-tag <name>', 'Remove a tag from every task (repeatable or comma-separated)', collectTagList, [])
    .action(async (options) => {
      try {
        const ids = String(options.ids)
          .split(',')
          .map((v: string) => v.trim())
          .filter(Boolean)
          .map((v: string) => parseId(v, '--ids'));
        checkUpdateTagOptions({ addTag: options.addTag, removeTag: options.removeTag });
        const tagging = needsCurrentTags(options);
        // the backend reads taskIds (BatchUpdateTaskDto); `ids` was silently ignored
        const updates: any = { taskIds: ids, ...skipAcceptanceFields(options) };
        if (options.status) updates.status = options.status;
        if (options.priority) updates.priority = options.priority;
        if (options.ownerId) updates.ownerId = parseInt(options.ownerId);

        if (tagging) {
          // idea #245: BatchUpdateTaskDto has no tags, so each task gets its own merged set (PUT replaces the set)
          let changed = 0;
          for (const taskId of ids) {
            const before = currentTagNames(await apiClient.get(`/progress/tasks/${taskId}`));
            const next = mergeTagNames(before, options);
            if (before.length === next.length && before.every((t) => next.includes(t))) continue;
            await apiClient.put(`/progress/tasks/${taskId}`, next.length ? { tags: next } : { tagIds: [] });
            changed += 1;
          }
          const add = normalizeTagNames(options.addTag, '--add-tag');
          const remove = normalizeTagNames(options.removeTag, '--remove-tag');
          const what = [add.length && `+${add.join(', +')}`, remove.length && `-${remove.join(', -')}`].filter(Boolean).join(' ');
          console.log(`✓ 已更新 ${changed} 个任务的标签（${what}），${ids.length - changed} 个无变化`);
          if (Object.keys(updates).length === 1) return;
        }

        const result = await apiClient.put('/progress/tasks/batch', updates);
        // idea #210: { successCount, failedCount, acceptanceRequired, acceptanceRequiredTaskIds }; older servers: a count
        const updated = typeof result === 'number' ? result : result?.successCount ?? ids.length;
        console.log(`✓ 已批量更新 ${updated} 个任务`);
        const awaiting: number[] = Array.isArray(result?.acceptanceRequiredTaskIds) ? result.acceptanceRequiredTaskIds : [];
        if (awaiting.length) {
          console.log(`✓ ${ACCEPTANCE_SUBMITTED}: ${awaiting.join(', ')}`);
        }
      } catch (error) {
        console.error('✗ 批量更新失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  registerDepCommands(taskCommand);
  registerTimeCommands(taskCommand);
  registerRequirementCommands(taskCommand);

  return taskCommand;
}

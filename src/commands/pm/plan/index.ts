import { Command } from 'commander';
import apiClient from '../../../services/ApiClient';
import { extractRecords } from '../../../utils/extractRecords';

function parseDateTime(input: string): string {
  // Accepts "YYYY-MM-DD HH:mm" (local time) or a value Date already understands.
  const normalized = input.includes('T') ? input : input.replace(' ', 'T');
  const d = new Date(normalized);
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid date/time: "${input}" (expected "YYYY-MM-DD HH:mm")`);
  }
  return d.toISOString();
}

function parseIdList(input: string): number[] {
  return input
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      const n = parseInt(s, 10);
      if (isNaN(n)) {
        throw new Error(`Invalid ID in list: "${s}"`);
      }
      return n;
    });
}

/** Optimistic-lock version isn't something a CLI user should have to track by hand:
 *  fetch the plan's current version unless the caller passed --version explicitly.
 *  A concurrent edit between this fetch and the write still surfaces as a normal
 *  "计划已被他人修改" error from the API — this only removes the common case of
 *  the CLI itself being the reason for a stale version. */
async function resolveVersion(planId: string, explicit?: string): Promise<number> {
  if (explicit !== undefined) {
    return parseInt(explicit, 10);
  }
  const plan = await apiClient.get(`/progress/execution-plans/${planId}`);
  return plan.plan.version;
}

function printPlanSummary(plan: any) {
  console.log(`ID:           ${plan.id}`);
  console.log(`名称:         ${plan.name}`);
  console.log(`项目ID:       ${plan.projectId}`);
  console.log(`状态:         ${plan.status}`);
  console.log(`执行模式:     ${plan.executionMode}`);
  console.log(`暂停方式:     ${plan.pauseKind || '-'}`);
  console.log(`计划开始:     ${plan.scheduledStartAt || '-'}`);
  console.log(`实际开始:     ${plan.actualStartAt || '-'}`);
  console.log(`预计耗时:     ${plan.estimatedDurationMinutes != null ? plan.estimatedDurationMinutes + ' min' : '-'} (${plan.estimatedDurationSource})`);
  console.log(`实际耗时:     ${plan.actualDurationMinutes != null ? plan.actualDurationMinutes + ' min' : '-'}`);
  console.log(`累计暂停:     ${plan.totalPausedSeconds || 0} 秒`);
  console.log(`失败/阻塞:    ${plan.failedItemCount || 0} / ${plan.blockedItemCount || 0}`);
  console.log(`版本:         ${plan.version}`);
}

function printItemsTable(items: any[]) {
  if (!items || !items.length) {
    console.log('(空链)');
    return;
  }
  console.log('SEQ'.padEnd(5) + 'ITEM ID'.padEnd(10) + 'TASK'.padEnd(10) + '状态'.padEnd(12) + '预计(min)'.padEnd(12) + '预计开始');
  console.log('─'.repeat(70));
  items.forEach((i: any) => {
    console.log(
      String(i.seq).padEnd(5) +
      String(i.id).padEnd(10) +
      String(i.taskId).padEnd(10) +
      (i.status || '-').padEnd(12) +
      String(i.estimatedDurationMinutes ?? '-').padEnd(12) +
      (i.plannedStartAt || '-')
    );
  });
}

function printDetail(vo: any, options: any) {
  if (options.json) {
    console.log(JSON.stringify(vo, null, 2));
    return;
  }
  console.log('\n执行计划详情');
  console.log('─'.repeat(50));
  printPlanSummary(vo.plan);
  console.log('\ntask 链');
  console.log('─'.repeat(70));
  printItemsTable(vo.items);
  if (vo.warnings && vo.warnings.length) {
    console.log('\n⚠ 警告');
    vo.warnings.forEach((w: string) => console.log('  - ' + w));
  }
}

function fail(action: string, error: unknown): never {
  console.error(`✗ ${action}失败:`, error instanceof Error ? error.message : String(error));
  process.exit(1);
}

export function registerPlanCommands(pmCommand: Command) {
  const planCommand = pmCommand
    .command('plan')
    .description('Execution plan management — orchestrate a chain of tasks with scheduling, pausing, and editing');

  planCommand
    .command('create')
    .description('Create an execution plan (draft)')
    .requiredOption('--project-id <id>', 'Project ID')
    .requiredOption('--name <name>', 'Plan name')
    .option('--description <desc>', 'Plan description')
    .option('--start <datetime>', 'Scheduled start, "YYYY-MM-DD HH:mm" (omit for manual start)')
    .option('--tasks <ids>', 'Ordered task IDs forming the chain (comma-separated)')
    .option('--execution-mode <mode>', 'sequential (default) | parallel_where_possible')
    .option('--json', 'Output result as JSON')
    .action(async (options) => {
      try {
        const body: any = {
          projectId: parseInt(options.projectId, 10),
          name: options.name,
        };
        if (options.description) body.description = options.description;
        if (options.start) body.scheduledStartAt = parseDateTime(options.start);
        if (options.executionMode) body.executionMode = options.executionMode;
        if (options.tasks) body.taskIds = parseIdList(options.tasks);

        const vo = await apiClient.post('/progress/execution-plans', body);
        if (options.json) {
          console.log(JSON.stringify(vo, null, 2));
          return;
        }
        console.log(`✓ 计划已创建: [${vo.plan.id}] ${vo.plan.name}（draft, ${vo.items.length} 个节点）`);
        if (vo.warnings && vo.warnings.length) {
          console.log('⚠ 警告:');
          vo.warnings.forEach((w: string) => console.log('  - ' + w));
        }
      } catch (error) {
        fail('创建计划', error);
      }
    });

  planCommand
    .command('list <project-id>')
    .description('List execution plans in a project')
    .option('--status <status>', 'Filter by status (draft|scheduled|running|pausing|paused|completed|failed|cancelled)')
    .option('--json', 'Output as JSON')
    .action(async (projectId, options) => {
      try {
        const params: any = { projectId: parseInt(projectId, 10) };
        if (options.status) params.status = options.status;
        const result = await apiClient.get('/progress/execution-plans', params);
        const records = extractRecords(result);

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        if (!records.length) {
          console.log('No execution plans found.');
          return;
        }
        console.log('\n执行计划列表');
        console.log('─'.repeat(90));
        console.log('ID'.padEnd(8) + '名称'.padEnd(30) + '状态'.padEnd(12) + '预计(min)'.padEnd(12) + '计划开始');
        console.log('─'.repeat(90));
        records.forEach((p: any) => {
          console.log(
            String(p.id).padEnd(8) +
            (p.name || '').substring(0, 28).padEnd(30) +
            (p.status || '-').padEnd(12) +
            String(p.estimatedDurationMinutes ?? '-').padEnd(12) +
            (p.scheduledStartAt || '-')
          );
        });
        console.log('─'.repeat(90));
      } catch (error) {
        fail('获取计划列表', error);
      }
    });

  planCommand
    .command('get <id>')
    .description('Get execution plan detail (chain + planned start times + warnings)')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      try {
        const vo = await apiClient.get(`/progress/execution-plans/${id}`);
        printDetail(vo, options);
      } catch (error) {
        fail('获取计划详情', error);
      }
    });

  planCommand
    .command('edit <id>')
    .description('Edit plan attributes (draft/scheduled: start time; non-terminal: name/description/duration)')
    .option('--name <name>', 'New name')
    .option('--description <desc>', 'New description')
    .option('--start <datetime>', 'New scheduled start, "YYYY-MM-DD HH:mm" (only draft/scheduled)')
    .option('--estimated-minutes <n>', 'Manually override estimated duration (switches source to manual)')
    .option('--execution-mode <mode>', 'sequential | parallel_where_possible (not while running)')
    .option('--version <n>', 'Version to submit against (default: auto-fetched current version)')
    .option('--json', 'Output result as JSON')
    .action(async (id, options) => {
      try {
        const version = await resolveVersion(id, options.version);
        const body: any = { version };
        if (options.name) body.name = options.name;
        if (options.description) body.description = options.description;
        if (options.start) body.scheduledStartAt = parseDateTime(options.start);
        if (options.estimatedMinutes) body.estimatedDurationMinutes = parseInt(options.estimatedMinutes, 10);
        if (options.executionMode) body.executionMode = options.executionMode;

        const vo = await apiClient.put(`/progress/execution-plans/${id}`, body);
        if (options.json) {
          console.log(JSON.stringify(vo, null, 2));
          return;
        }
        console.log(`✓ 计划已更新: [${vo.plan.id}] ${vo.plan.name}（version=${vo.plan.version}）`);
      } catch (error) {
        fail('更新计划', error);
      }
    });

  planCommand
    .command('delete <id>')
    .description('Delete plan (draft or terminal states only)')
    .action(async (id) => {
      try {
        await apiClient.delete(`/progress/execution-plans/${id}`);
        console.log(`✓ 计划 #${id} 已删除`);
      } catch (error) {
        fail('删除计划', error);
      }
    });

  // ---------------- Chain editing ----------------

  planCommand
    .command('add-task <id>')
    .description('Append or insert a task into the chain')
    .requiredOption('--task <task-id>', 'Task ID to add')
    .option('--after <item-id>', 'Insert after this item ID (omit = append to tail)')
    .option('--version <n>', 'Version to submit against (default: auto-fetched current version)')
    .option('--json', 'Output result as JSON')
    .action(async (id, options) => {
      try {
        const version = await resolveVersion(id, options.version);
        const body: any = { taskId: parseInt(options.task, 10), version };
        if (options.after) body.afterItemId = parseInt(options.after, 10);

        const vo = await apiClient.post(`/progress/execution-plans/${id}/items`, body);
        if (options.json) {
          console.log(JSON.stringify(vo, null, 2));
          return;
        }
        console.log(`✓ 任务 #${options.task} 已加入计划 #${id}（version=${vo.plan.version}）`);
        if (vo.warnings && vo.warnings.length) {
          console.log('⚠ 警告:');
          vo.warnings.forEach((w: string) => console.log('  - ' + w));
        }
      } catch (error) {
        fail('添加节点', error);
      }
    });

  planCommand
    .command('remove-item <id>')
    .description('Remove a pending item from the chain')
    .requiredOption('--item <item-id>', 'Item ID to remove')
    .action(async (id, options) => {
      try {
        const vo = await apiClient.delete(`/progress/execution-plans/${id}/items/${options.item}`);
        console.log(`✓ 节点 #${options.item} 已移除（version=${vo.plan.version}）`);
      } catch (error) {
        fail('移除节点', error);
      }
    });

  planCommand
    .command('reorder <id>')
    .description('Reorder pending items (full item-ID list in the desired order)')
    .requiredOption('--items <item-ids>', 'Full item ID list, comma-separated, in the desired order')
    .option('--version <n>', 'Version to submit against (default: auto-fetched current version)')
    .option('--json', 'Output result as JSON')
    .action(async (id, options) => {
      try {
        const version = await resolveVersion(id, options.version);
        const body = { version, itemIds: parseIdList(options.items) };

        const vo = await apiClient.put(`/progress/execution-plans/${id}/items/reorder`, body);
        if (options.json) {
          console.log(JSON.stringify(vo, null, 2));
          return;
        }
        console.log(`✓ 已重排（version=${vo.plan.version}）`);
        printItemsTable(vo.items);
      } catch (error) {
        fail('重排节点', error);
      }
    });

  planCommand
    .command('skip-item <id>')
    .description('Skip a pending item')
    .requiredOption('--item <item-id>', 'Item ID to skip')
    .option('--reason <text>', 'Reason for skipping')
    .option('--version <n>', 'Version to submit against (default: auto-fetched current version)')
    .action(async (id, options) => {
      try {
        const version = await resolveVersion(id, options.version);
        const body: any = { version };
        if (options.reason) body.reason = options.reason;

        const vo = await apiClient.post(`/progress/execution-plans/${id}/items/${options.item}/skip`, body);
        console.log(`✓ 节点 #${options.item} 已跳过（version=${vo.plan.version}）`);
      } catch (error) {
        fail('跳过节点', error);
      }
    });

  // ---------------- State actions ----------------

  planCommand
    .command('schedule <id>')
    .description('draft → scheduled')
    .action(async (id) => {
      try {
        const plan = await apiClient.post(`/progress/execution-plans/${id}/schedule`);
        console.log(`✓ 计划 #${id} 已排期: ${plan.scheduledStartAt || '(等待手动启动)'}`);
      } catch (error) {
        fail('排期', error);
      }
    });

  planCommand
    .command('start <id>')
    .description('Start now (draft / scheduled → running)')
    .action(async (id) => {
      try {
        const plan = await apiClient.post(`/progress/execution-plans/${id}/start`);
        console.log(`✓ 计划 #${id} 已启动 → ${plan.status}`);
      } catch (error) {
        fail('启动', error);
      }
    });

  planCommand
    .command('pause <id>')
    .description('Graceful pause: let the currently running item finish, then pause')
    .action(async (id) => {
      try {
        const plan = await apiClient.post(`/progress/execution-plans/${id}/pause`);
        console.log(`✓ 计划 #${id} → ${plan.status}` + (plan.status === 'pausing' ? '（等待当前节点完成）' : ''));
      } catch (error) {
        fail('暂停', error);
      }
    });

  planCommand
    .command('halt <id>')
    .description('Force pause: terminate the running item immediately (may leave a dirty state)')
    .requiredOption('--reason <text>', 'Why this task is being force-stopped (required)')
    .option('--yes', 'Confirm the destructive action (required to actually run)')
    .action(async (id, options) => {
      if (!options.yes) {
        console.error('✗ 强制暂停会立即终止执行中的任务并可能留下脏状态（未提交的代码/部署中断）。');
        console.error('  确认无误后加 --yes 重试：good7ob pm plan halt ' + id + ' --reason "..." --yes');
        process.exit(1);
      }
      try {
        const plan = await apiClient.post(`/progress/execution-plans/${id}/halt`, {
          confirm: true,
          reason: options.reason,
        });
        console.log(`✓ 计划 #${id} 已强制暂停 → ${plan.status}（pauseKind=${plan.pauseKind}）`);
      } catch (error) {
        fail('强制暂停', error);
      }
    });

  planCommand
    .command('resume <id>')
    .description('Resume (paused → running; pausing → running cancels the pause request)')
    .action(async (id) => {
      try {
        const plan = await apiClient.post(`/progress/execution-plans/${id}/resume`);
        console.log(`✓ 计划 #${id} → ${plan.status}（累计暂停 ${plan.totalPausedSeconds || 0} 秒）`);
      } catch (error) {
        fail('恢复', error);
      }
    });

  planCommand
    .command('cancel <id>')
    .description('Cancel the plan (any non-terminal state)')
    .action(async (id) => {
      try {
        const plan = await apiClient.post(`/progress/execution-plans/${id}/cancel`);
        console.log(`✓ 计划 #${id} → ${plan.status}`);
      } catch (error) {
        fail('取消', error);
      }
    });

  planCommand
    .command('events <id>')
    .description('Event timeline (append-only)')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      try {
        const result = await apiClient.get(`/progress/execution-plans/${id}/events`);
        const records = extractRecords(result);

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        if (!records.length) {
          console.log('No events found.');
          return;
        }
        console.log('\n事件时间线');
        console.log('─'.repeat(100));
        records.forEach((e: any) => {
          const who = e.operatorType === 'HUMAN' ? `HUMAN#${e.operatorId}` : e.operatorType;
          console.log(`${e.createdAt}  [${who}]  ${e.eventType}` + (e.itemId ? `  item#${e.itemId}` : ''));
          if (e.message) {
            console.log(`    ${e.message}`);
          }
        });
        console.log('─'.repeat(100));
      } catch (error) {
        fail('获取事件时间线', error);
      }
    });

  return planCommand;
}

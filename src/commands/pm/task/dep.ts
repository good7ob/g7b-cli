import { Command } from 'commander';
import apiClient from '../../../services/ApiClient';
import { emit, guarded, parseId, parseIdList } from '../../../utils/cliHelpers';
import { addPredecessors, DEP_TYPES, MAX_PREDECESSORS, parseDepType, Predecessor, removePredecessors } from './depPlan';

interface DepItem {
  taskId: number;
  name?: string;
  status?: string;
  dependencyType?: string;
}

interface Dependencies {
  predecessors?: DepItem[];
  successors?: DepItem[];
  blockingCount?: number;
}

const FAIL = '任务依赖操作失败';
const depsUrl = (id: number) => `/progress/tasks/${id}/dependencies`;

const toPredecessors = (items: DepItem[] | undefined): Predecessor[] =>
  (items ?? []).map((p) => ({ taskId: p.taskId, dependencyType: p.dependencyType ?? 'finish_to_start' }));

function renderList(title: string, items: DepItem[] | undefined): string {
  const rows = (items ?? []).map((p) => `  #${p.taskId}  [${p.status ?? '-'}]  ${p.name ?? ''}  (${p.dependencyType ?? '-'})`);
  return [`${title}（${rows.length}）`, ...(rows.length ? rows : ['  无'])].join('\n');
}

function render(id: number, deps: Dependencies): string {
  return [
    `任务 #${id} 的依赖`,
    renderList('前置任务（需先完成）', deps.predecessors),
    renderList('后置任务（依赖本任务）', deps.successors),
    `未满足的前置数: ${deps.blockingCount ?? 0}`,
  ].join('\n');
}

/** The backend replaces the whole predecessor set; send it and return the dependencies it echoes back. */
async function savePredecessors(id: number, next: Predecessor[]): Promise<Dependencies> {
  return apiClient.put(`/progress/tasks/${id}/predecessors`, { predecessors: next });
}

export function registerDepCommands(taskCommand: Command) {
  const dep = taskCommand
    .command('dep')
    .description('Task dependencies — list, add, remove predecessors (same project, no cycles)');

  dep
    .command('list <task-id>')
    .description('Show a task’s predecessors and successors')
    .option('--json', 'Output as JSON')
    .action((taskArg, options) =>
      guarded(FAIL, {}, async () => {
        const id = parseId(taskArg, 'task-id');
        const deps: Dependencies = await apiClient.get(depsUrl(id));
        emit(options.json, deps, () => render(id, deps));
      }),
    );

  dep
    .command('add <task-id>')
    .description('Make <task-id> depend on the tasks given by --on (it can start/finish only after them)')
    .requiredOption('--on <ids>', `Comma-separated predecessor task IDs (max ${MAX_PREDECESSORS} in total)`)
    .option('--type <type>', `Dependency type: ${DEP_TYPES.join(' | ')} (default finish_to_start)`)
    .option('--json', 'Output as JSON')
    .action((taskArg, options) =>
      guarded(FAIL, {}, async () => {
        const id = parseId(taskArg, 'task-id');
        const ids = parseIdList(options.on, '--on', MAX_PREDECESSORS);
        const type = parseDepType(options.type);
        const current: Dependencies = await apiClient.get(depsUrl(id));
        const { next, changed } = addPredecessors(toPredecessors(current.predecessors), ids, type);
        if (!changed) {
          console.log(`✓ 无需修改：任务 #${id} 已依赖 ${ids.map((i) => `#${i}`).join(', ')}（${type}）`);
          return;
        }
        const saved = await savePredecessors(id, next);
        console.log(`✓ 已设置：任务 #${id} 依赖 ${ids.map((i) => `#${i}`).join(', ')}（${type}）`);
        emit(options.json, saved, () => render(id, saved));
      }),
    );

  dep
    .command('remove <task-id>')
    .description('Remove predecessors given by --on from <task-id>')
    .requiredOption('--on <ids>', 'Comma-separated predecessor task IDs to remove')
    .option('--json', 'Output as JSON')
    .action((taskArg, options) =>
      guarded(FAIL, {}, async () => {
        const id = parseId(taskArg, 'task-id');
        const ids = parseIdList(options.on, '--on', MAX_PREDECESSORS);
        const current: Dependencies = await apiClient.get(depsUrl(id));
        const { next, missing } = removePredecessors(toPredecessors(current.predecessors), ids);
        if (missing.length) console.log(`! 这些不是任务 #${id} 的前置任务，已忽略: ${missing.map((i) => `#${i}`).join(', ')}`);
        if (missing.length === ids.length) return;
        const saved = await savePredecessors(id, next);
        console.log(`✓ 已移除：任务 #${id} 不再依赖 ${ids.filter((i) => !missing.includes(i)).map((i) => `#${i}`).join(', ')}`);
        emit(options.json, saved, () => render(id, saved));
      }),
    );
}

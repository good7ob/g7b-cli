import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { ErrorCodeMap, emit, fail, parseId } from '../../utils/cliHelpers';
import {
  ACTION_ERROR_CODES, ACTION_TYPES, Decision, MAX_QUEUE_LIMIT, MAX_SNOOZE_DAYS, QUEUE_SORTS, QUEUE_STATUSES, WORKSPACE_ERROR_CODES,
  buildActionBody, buildQueueParams, parseSnoozeUntil,
} from './input';
import {
  MyQueue, QueueActionResult, QueueCounts, QueueItem, Transition, renderDecision, renderQueue, renderQueueCounts,
  renderTransition,
} from './render';

/**
 * `workspace queue` (the persisted "awaiting me" queue) and its item commands. `queue` itself
 * lists; the subcommands act on one item by its queue-item id (the ID column of the list, not
 * the source object's id). Business errors come back as HTTP 200 + non-200 `code`; ApiClient
 * throws on those and `fail` maps the codes.
 */

const BASE = '/workspace/my-queue';

/**
 * `queue` itself defines --json (and --limit …), and commander lets an ancestor consume a known
 * option wherever it appears — `queue counts --json` never reaches `counts`. Read it from the chain.
 */
const wantsJson = (cmd: Command): boolean => Boolean(cmd.optsWithGlobals().json);

/** Run an action; any failure (bad input or API) ends as a readable one-line error + exit 1. */
async function run(prefix: string, codes: ErrorCodeMap, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    fail(prefix, error, codes);
  }
}

/** A decision may run the Agent synchronously and outlast the client timeout while the server carries on. */
function withTimeoutHint(error: unknown): unknown {
  const message = error instanceof Error ? error.message : String(error);
  return /timeout/i.test(message)
    ? new Error(`${message}（服务端可能仍在处理，尤其是会恢复 Agent 执行的计划审批 —— 请先用 good7ob workspace queue --status all 核对，不要盲目重试）`)
    : error;
}

async function moveItem(kind: Transition, rawId: string, json: boolean | undefined, body?: unknown): Promise<void> {
  const id = parseId(rawId, 'id');
  const item: QueueItem = await apiClient.post(`${BASE}/${id}/${kind}`, body);
  emit(json, item, () => renderTransition(kind, id, item));
}

async function decide(decision: Decision, rawId: string, comment: string | undefined, json: boolean): Promise<void> {
  const id = parseId(rawId, 'id');
  const body = buildActionBody(decision, comment);
  const result: QueueActionResult = await apiClient.post(`${BASE}/${id}/action`, body).catch((e: unknown) => {
    throw withTimeoutHint(e);
  });
  emit(json, result, () => renderDecision(id, result));
}

function registerItemCommands(queue: Command): void {
  queue
    .command('counts')
    .description('Queue counters: active total per action type, plus snoozed / dismissed / done')
    .option('--json', 'Output as JSON')
    .action((_o, cmd: Command) => run('获取待办队列计数失败', WORKSPACE_ERROR_CODES, async () => {
      const counts: QueueCounts = await apiClient.get(`${BASE}/counts`);
      emit(wantsJson(cmd), counts, () => renderQueueCounts(counts ?? {}));
    }));

  const simple: Array<[Exclude<Transition, 'snooze'>, string, string]> = [
    ['dismiss', 'Hide an item while its source stays live (idempotent; not for done items)', '忽略队列项失败'],
    ['done', 'Mark an item handled (idempotent)', '标记队列项已处理失败'],
    ['reopen', 'Bring a dismissed / snoozed / done item back as new (no-op for an active one)', '重新打开队列项失败'],
  ];
  simple.forEach(([kind, description, prefix]) =>
    queue
      .command(`${kind} <id>`)
      .description(description)
      .option('--json', 'Output as JSON')
      .action((id, _o, cmd: Command) => run(prefix, WORKSPACE_ERROR_CODES, () => moveItem(kind, id, wantsJson(cmd)))));

  queue
    .command('snooze <id>')
    .description(`Hide an item until a future time (at most ${MAX_SNOOZE_DAYS} days ahead; snoozing again moves the time)`)
    .requiredOption('--until <time>', 'ISO date-time (no offset = UTC, e.g. 2026-09-20T09:00:00Z) or relative: +30m, +2h, +1d')
    .option('--json', 'Output as JSON')
    .action((id, o, cmd: Command) => run('稍后处理队列项失败', WORKSPACE_ERROR_CODES, () =>
      moveItem('snooze', id, wantsJson(cmd), { until: parseSnoozeUntil(o.until) })));
}

function registerDecisionCommands(queue: Command): void {
  queue
    .command('approve <id>')
    .description('Approve the object behind an item in place: an approval request, a task plan (resumes the Agent) or a task completion')
    .option('--comment <text>', 'Optional note (recorded for approval requests only)')
    .option('--json', 'Output as JSON')
    .action((id, o, cmd: Command) => run('批准队列项失败', ACTION_ERROR_CODES, () => decide('approve', id, o.comment, wantsJson(cmd))));

  queue
    .command('reject <id>')
    .description('Reject the object behind an item in place (approval request, task plan or task completion)')
    .requiredOption('--comment <text>', 'Why (required)')
    .option('--json', 'Output as JSON')
    .action((id, o, cmd: Command) => run('驳回队列项失败', ACTION_ERROR_CODES, () => decide('reject', id, o.comment, wantsJson(cmd))));
}

export function registerQueueCommands(workspace: Command): void {
  const queue = workspace
    .command('queue')
    .description('List items awaiting me, newest first or by priority score (counts cover everything, the table is capped by --limit); subcommands act on one item')
    .allowExcessArguments(false)
    .option('-l, --limit <num>', `Max items to list (1-${MAX_QUEUE_LIMIT})`, '50')
    .option('--status <status>', `Filter by status (${QUEUE_STATUSES.join('|')}; default active)`)
    .option('--action-type <type>', `Filter by action type (${ACTION_TYPES.join('|')}); counts ignore it`)
    .option('--product <id>', 'Only items of this product')
    .option('--sort <sort>', `Order (${QUEUE_SORTS.join('|')}; default newest). score = highest priority score first, ties by earliest due`)
    .option('--json', 'Output as JSON')
    .action((o) => run('获取我的待办队列失败', WORKSPACE_ERROR_CODES, async () => {
      const params = buildQueueParams(o);
      const result: MyQueue = await apiClient.get(BASE, params);
      emit(o.json, result, () => renderQueue(result ?? {}, params.status as string | undefined));
    }));

  registerItemCommands(queue);
  registerDecisionCommands(queue);
}

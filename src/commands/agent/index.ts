/**
 * `good7ob agent` — let the machine an agent (Hermes / Claude Code / Codex) runs on
 * pull good7ob AI tasks itself. One local work slot; see state.ts for the transitions.
 *
 * prd-0136 (idea #189, N-4): `listen` registers this machine as a Runner of the AI employee behind the key,
 * keeps the runner heartbeat going, and pulls the scheduler's assigned items first (`?runnerId=`).
 */

import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import configService from '../../services/ConfigService';
import { InputError, parseId } from '../../utils/cliHelpers';
import { INTERVAL_MS as HEARTBEAT_INTERVAL_MS, finish as finishHeartbeat, sendBeat } from '../heartbeat';
import { runLoop } from '../heartbeat/loop';
import { writeEntry as writeHeartbeatEntry } from '../heartbeat/state';
import { AgentConfig, requireForward, resolveAgentConfig } from './config';
import { ForwardTask, forwardCommand, forwardWebhook } from './forward';
import { RoundDeps, releaseTask, runRound } from './round';
import {
  HeartbeatRunner,
  REGISTER_PATH,
  RunnerOptions,
  describeAssignment,
  describeRunner,
  isFatalAuth,
  registerPayload,
  resolveRunnerOptions,
  toRegistration,
} from './runner';
import { AgentState, AgentStateStore, IDLE, RunnerRegistration } from './state';

const EXIT_BUSY = 3;
const EXIT_EMPTY = 4;
/** Queue had items, but every one of them is assigned to another runner / employee (409 ASSIGNED_TO_OTHER). */
const EXIT_ASSIGNED_ELSEWHERE = 5;

const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
const stamp = (msg: string) => `[${new Date().toISOString()}] ${msg}`;

function fail(prefix: string, e: unknown): never {
  console.error(e instanceof InputError ? `✗ 参数错误: ${e.message}` : `✗ ${prefix}: ${msgOf(e)}`);
  process.exit(1);
}

function loadConfig(): AgentConfig {
  return resolveAgentConfig(configService.get('agent'));
}

function deps(cfg: AgentConfig, store: AgentStateStore, log: (m: string) => void, runnerId?: number): RoundDeps {
  return { api: apiClient, store, cfg, log, runnerId };
}

function describeSlot(state: AgentState, nowMs = Date.now()): string {
  if (state.status === 'idle') return '空闲（idle）';
  const left = Math.round((Date.parse(state.deadline) - nowMs) / 60_000);
  const timing = left >= 0 ? `剩余约 ${left} 分钟` : `已超时 ${-left} 分钟`;
  const lines = [
    `${state.status === 'busy' ? '处理中（busy）' : '已超时（timeout）'} 任务 #${state.taskId} ${state.taskNo ?? ''} ${state.name}`,
    `  项目: ${state.projectId ?? '-'}  领取: ${state.claimedAt}  截止: ${state.deadline}  ${timing}`,
  ];
  if (state.assignmentId != null || state.stepId != null) {
    lines.push(`  分配: #${state.assignmentId ?? '-'}  运行: #${state.runId ?? '-'}  步骤: #${state.stepId ?? '-'}  节点: ${state.nodeCode ?? '-'}`);
  }
  if (state.stopRequestedAt) lines.push(`  ! 后端已于 ${state.stopRequestedAt} 要求停止该步骤（服务端已释放，本地不再退回）`);
  return lines.join('\n');
}

/** A sleep that `wake()` can cut short, so SIGINT ends both loops of `listen` at once. */
function makeSleeper() {
  const wakers = new Set<() => void>();
  return {
    sleep: (ms: number) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          wakers.delete(wake);
          resolve();
        }, ms);
        const wake = () => {
          clearTimeout(timer);
          wakers.delete(wake);
          resolve();
        };
        wakers.add(wake);
      }),
    wakeAll: () => wakers.forEach((w) => w()),
  };
}

/** `POST /api/v1/me/runners`, retried on transient errors (rp-auto-sched-0014); a rejected key ends the command. */
async function registerRunner(
  opts: RunnerOptions,
  store: AgentStateStore,
  log: (m: string) => void,
  retry: { once: boolean; intervalMs: number; sleep: (ms: number) => Promise<void>; stopping: () => boolean }
): Promise<RunnerRegistration | null> {
  for (;;) {
    try {
      const data = await apiClient.post(REGISTER_PATH, registerPayload(opts));
      const reg = toRegistration(data, opts);
      await store.withLock(async () => store.writeRunner(reg));
      return reg;
    } catch (e) {
      if (isFatalAuth(e)) fail('注册 Runner 失败（需要 AI 员工 Key）', e);
      if (e instanceof InputError) fail('注册 Runner 失败', e);
      if (retry.once) fail('注册 Runner 失败', e);
      log(`注册 Runner 失败，${retry.intervalMs / 1000}s 后重试: ${msgOf(e)}`);
      await retry.sleep(retry.intervalMs);
      if (retry.stopping()) return null;
    }
  }
}

/** Heartbeat said stop: the backend already released those steps, so only the local slot is marked (no release). */
async function handleStopSteps(stepIds: number[], store: AgentStateStore, log: (m: string) => void): Promise<void> {
  log(`! 后端要求停止步骤: ${stepIds.join(', ')}`);
  await store.withLock(async () => {
    const cur = store.read();
    if (cur.status === 'idle' || cur.stepId == null || !stepIds.includes(cur.stepId) || cur.stopRequestedAt) return;
    store.write({ ...cur, stopRequestedAt: new Date().toISOString() });
    log(`本地任务 #${cur.taskId}（步骤 #${cur.stepId}）已标记停止：本机 agent 请终止执行，槽位在后端状态变化后自动释放`);
  });
}

export function registerAgentCommands(program: Command) {
  const agent = program
    .command('agent')
    .description('Let a local AI agent pull good7ob AI tasks (single work slot per machine)');

  agent
    .command('listen')
    .description('Register this machine as a Runner, keep its heartbeat, poll the AI task queue (assigned items first), claim one task at a time and hand it to the local agent')
    .option('--interval <seconds>', 'Polling interval in seconds (overrides agent.intervalSeconds)')
    .option('--once', 'Run a single round and exit')
    .option('--slots <n>', 'Runner slots announced to the scheduler, 1-8 (default: agent.slots or 1)')
    .option('--env <tags>', 'Runner env tags, comma separated subset of dev,test,prod (default: agent.envTags or none)')
    .option('--agent-kind <code>', 'Agent kind, e.g. CLAUDE_CODE / CODEX (default: agent.agentKind or CLAUDE_CODE)')
    .option('--host-id <id>', 'Host identity the runner is registered under (default: agent.hostId or the hostname)')
    .action(async (opts) => {
      let cfg: AgentConfig;
      let runnerOpts: RunnerOptions;
      try {
        cfg = loadConfig();
        if (opts.interval !== undefined) cfg = resolveAgentConfig({ ...configService.get('agent'), intervalSeconds: opts.interval });
        requireForward(cfg);
        runnerOpts = resolveRunnerOptions(opts, cfg);
      } catch (e) {
        fail('agent 配置无效', e);
      }
      const { url, secret, command } = cfg.forward;
      const forward = url
        ? (t: ForwardTask) => forwardWebhook(url, secret as string, t)
        : (t: ForwardTask) => forwardCommand(command as string, t);
      const log = (m: string) => console.log(stamp(m));
      const store = new AgentStateStore();
      const { sleep, wakeAll } = makeSleeper();

      let stopping = false;
      let exitCode = 0;
      const stop = (why = '收到退出信号') => {
        if (stopping) return;
        stopping = true;
        log(`${why}，退出（当前任务不退回；未开始的分配由后端收回）`);
        wakeAll();
      };
      process.once('SIGINT', () => stop());
      process.once('SIGTERM', () => stop());

      // 1. register (idempotent on employee + host id)
      const reg = await registerRunner(runnerOpts, store, log, {
        once: !!opts.once,
        intervalMs: cfg.intervalSeconds * 1000,
        sleep,
        stopping: () => stopping,
      });
      if (!reg) return;
      log(`Runner 已注册: #${reg.runnerId} ${reg.hostLabel}（hostId ${reg.runnerKey}，slots ${reg.slots}，env ${reg.envTags.join(',') || '无'}，${reg.agentKind}）`);
      if (reg.slots > 1) log(`提示: 本机仍按单工作槽执行，slots=${reg.slots} 只用于向调度器申报容量`);

      // 2. heartbeat loop (same loop as `good7ob heartbeat`), in-process so stopStepIds reach the local slot
      const hbRunner: HeartbeatRunner = { runnerId: reg.runnerId, runnerKey: reg.runnerKey };
      writeHeartbeatEntry({
        agentPid: process.pid,
        loopPid: process.pid,
        startedAt: new Date().toISOString(),
        runner: { ...hbRunner, slots: reg.slots, envTags: reg.envTags },
      });
      let lastBeatFailure = '';
      const beat = async () => {
        const r = await sendBeat(hbRunner);
        if (r.result === 'retry' && r.message !== lastBeatFailure) log(`心跳失败，继续重试: ${r.message}`);
        lastBeatFailure = r.result === 'retry' ? r.message ?? '' : '';
        if (r.stopStepIds.length) await handleStopSteps(r.stopStepIds, store, log);
        return r.result;
      };
      const heartbeat = opts.once
        ? beat().then((r) => (r === 'fatal' ? 'fatal' : 'agent-gone'))
        : runLoop({ beat, agentAlive: () => !stopping, sleep, intervalMs: HEARTBEAT_INTERVAL_MS });
      const heartbeatDone = heartbeat.then((end) => {
        if (end === 'fatal') {
          exitCode = 1;
          stop('心跳被后端拒绝（Key 无效或非 AI 员工 Key）');
        }
      });

      // 3. poll → claim (assigned first) → forward
      const d = deps(cfg, store, log, reg.runnerId);
      log(`开始监听 AI 任务队列（间隔 ${cfg.intervalSeconds}s，转交: ${url ? `webhook ${url}` : 'command'}${cfg.projectId ? `，项目 ${cfg.projectId}` : ''}，runnerId ${reg.runnerId}）`);
      let lastKind = '';
      while (!stopping) {
        try {
          const r = await runRound(d, forward);
          // busy / empty repeat every round; only say so when it changes.
          if (r.kind !== lastKind && (r.kind === 'busy' || r.kind === 'empty' || r.kind === 'assigned_elsewhere')) {
            log(
              r.kind === 'busy'
                ? describeSlot(r.state)
                : r.kind === 'assigned_elsewhere'
                ? `队列中的任务 #${r.refused.join(', #')} 已分配给其他 Runner，等待分配给本 Runner 的工作项`
                : '队列为空，等待新任务'
            );
          }
          if (r.kind === 'claimed') {
            const ctx = describeAssignment(r.task);
            if (ctx) console.log(ctx);
          }
          lastKind = r.kind;
        } catch (e) {
          log(`本轮失败: ${msgOf(e)}`);
          lastKind = '';
        }
        if (opts.once || stopping) break;
        await sleep(cfg.intervalSeconds * 1000);
      }
      stopping = true;
      wakeAll();
      await heartbeatDone;
      // rp-auto-sched-0013: clean exit frees the runner's unclaimed leases
      await finishHeartbeat(process.pid, hbRunner);
      if (exitCode) process.exit(exitCode);
    });

  agent
    .command('next')
    .description(`Claim the next task for the calling agent (exit ${EXIT_BUSY}: slot busy, ${EXIT_EMPTY}: queue empty, ${EXIT_ASSIGNED_ELSEWHERE}: only tasks assigned to other runners)`)
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      let r;
      let runner: RunnerRegistration | null = null;
      try {
        const store = new AgentStateStore();
        runner = store.readRunner();
        r = await runRound(deps(loadConfig(), store, (m) => console.error(m), runner?.runnerId));
      } catch (e) {
        fail('领取任务失败', e);
      }
      if (r.kind === 'empty') {
        console.log(opts.json ? JSON.stringify({ status: 'empty' }) : '队列为空，没有可领取的任务');
        process.exit(EXIT_EMPTY);
      }
      if (r.kind === 'assigned_elsewhere') {
        console.log(
          opts.json
            ? JSON.stringify({ status: 'assigned_elsewhere', refused: r.refused })
            : `队列中的任务 #${r.refused.join(', #')} 已分配给其他 Runner（409），本 Runner${runner ? ` #${runner.runnerId}` : '（未注册）'} 无可领取的任务`
        );
        process.exit(EXIT_ASSIGNED_ELSEWHERE);
      }
      if (r.kind === 'busy') {
        console.log(opts.json ? JSON.stringify(r.state, null, 2) : `本机已有任务在处理，不领取新任务:\n${describeSlot(r.state)}`);
        process.exit(EXIT_BUSY);
      }
      if (r.kind === 'claimed') {
        if (opts.json) return console.log(JSON.stringify({ slot: r.state, task: r.task, runner }, null, 2));
        const ctx = describeAssignment(r.task);
        console.log(`✓ 已领取:\n${describeSlot(r.state)}${ctx ? `\n${ctx}` : ''}`);
      }
    });

  agent
    .command('done <taskId>')
    .description('Mark the task finished on the backend and free the local slot')
    .option('--status <status>', 'Target status (e.g. awaiting_completion_approval for gated tasks)', 'completed')
    .action(async (taskId, opts) => {
      try {
        const id = parseId(taskId, 'taskId');
        // Backend state machine errors (e.g. gated tasks) are surfaced verbatim by ApiClient.
        await apiClient.put(`/progress/tasks/${id}`, { status: opts.status });
        const store = new AgentStateStore();
        await store.withLock(async () => {
          const cur = store.read();
          if (cur.status !== 'idle' && cur.taskId !== id) {
            console.error(`! 本地记录的任务是 #${cur.taskId}，与 #${id} 不一致；本地工作槽仍按要求清空`);
          }
          store.write(IDLE);
        });
        console.log(`✓ 任务 #${id} 已更新为 ${opts.status}，本地工作槽已空闲`);
      } catch (e) {
        fail('更新任务状态失败', e);
      }
    });

  agent
    .command('status')
    .description('Show the local work slot, the runner registration and the effective agent config')
    .option('--json', 'Output as JSON')
    .action((opts) => {
      try {
        const cfg = loadConfig();
        const store = new AgentStateStore();
        const slot = store.read();
        const runner = store.readRunner();
        if (opts.json) return console.log(JSON.stringify({ slot, runner, config: { ...cfg, forward: { ...cfg.forward, secret: cfg.forward.secret ? '(set)' : undefined } } }, null, 2));
        const { url, secret, command } = cfg.forward;
        console.log(`工作槽: ${describeSlot(slot)}`);
        console.log(`Runner: ${describeRunner(runner)}`);
        console.log('配置:');
        console.log(`  intervalSeconds: ${cfg.intervalSeconds}`);
        console.log(`  expectedMinutes: ${cfg.expectedMinutes}`);
        console.log(`  graceMinutes:    ${cfg.graceMinutes}`);
        console.log(`  projectId:       ${cfg.projectId ?? '(全部)'}`);
        console.log(`  slots:           ${cfg.slots ?? '(默认 1)'}`);
        console.log(`  envTags:         ${cfg.envTags?.length ? cfg.envTags.join(',') : '(无)'}`);
        console.log(`  agentKind:       ${cfg.agentKind ?? '(默认 CLAUDE_CODE)'}`);
        console.log(`  hostId:          ${cfg.hostId ?? '(默认 hostname)'}`);
        console.log(`  forward.url:     ${url || '(not set)'}`);
        console.log(`  forward.secret:  ${secret ? '(set)' : '(not set)'}`);
        console.log(`  forward.command: ${command || '(not set)'}`);
      } catch (e) {
        fail('读取 agent 状态失败', e);
      }
    });

  agent
    .command('reset')
    .description('Force the local slot back to idle and forget the runner registration (listen re-registers)')
    .option('--release', 'Release the current task back to the queue first')
    .option('--keep-runner', 'Keep the runner registration, only reset the slot')
    .action(async (opts) => {
      try {
        const store = new AgentStateStore();
        let hadRunner = false;
        await store.withLock(async () => {
          // A corrupt state file must still be resettable, so don't let read() block a plain reset.
          let cur: AgentState = IDLE;
          let runner: RunnerRegistration | null = null;
          try {
            cur = store.read();
            runner = store.readRunner();
          } catch (e) {
            if (opts.release) throw e;
          }
          if (opts.release && cur.status !== 'idle') {
            const r = await releaseTask(apiClient, cur.taskId, '本机 agent 手动 reset 退回');
            console.log(`✓ 任务 #${cur.taskId} 已退回（${r?.status ?? '-'}）`);
          }
          hadRunner = !!runner;
          store.write(IDLE);
          if (!opts.keepRunner) store.writeRunner(null);
        });
        console.log(`✓ 本地工作槽已重置为 idle${opts.keepRunner ? '' : hadRunner ? '，Runner 注册记录已清除' : ''}`);
      } catch (e) {
        fail('重置失败', e);
      }
    });

  return agent;
}

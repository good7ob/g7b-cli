/**
 * `good7ob agent` — let the machine an agent (Hermes / Claude Code / Codex) runs on
 * pull good7ob AI tasks itself. One local work slot; see state.ts for the transitions.
 */

import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import configService from '../../services/ConfigService';
import { parseId } from '../../utils/cliHelpers';
import { AgentConfig, requireForward, resolveAgentConfig } from './config';
import { ForwardTask, forwardCommand, forwardWebhook } from './forward';
import { RoundDeps, releaseTask, runRound } from './round';
import { AgentState, AgentStateStore, IDLE } from './state';

const EXIT_BUSY = 3;
const EXIT_EMPTY = 4;

const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
const stamp = (msg: string) => `[${new Date().toISOString()}] ${msg}`;

function fail(prefix: string, e: unknown): never {
  console.error(`✗ ${prefix}: ${msgOf(e)}`);
  process.exit(1);
}

function loadConfig(): AgentConfig {
  return resolveAgentConfig(configService.get('agent'));
}

function deps(cfg: AgentConfig, store: AgentStateStore, log: (m: string) => void): RoundDeps {
  return { api: apiClient, store, cfg, log };
}

function describeSlot(state: AgentState, nowMs = Date.now()): string {
  if (state.status === 'idle') return '空闲（idle）';
  const left = Math.round((Date.parse(state.deadline) - nowMs) / 60_000);
  const timing = left >= 0 ? `剩余约 ${left} 分钟` : `已超时 ${-left} 分钟`;
  return [
    `${state.status === 'busy' ? '处理中（busy）' : '已超时（timeout）'} 任务 #${state.taskId} ${state.taskNo ?? ''} ${state.name}`,
    `  项目: ${state.projectId ?? '-'}  领取: ${state.claimedAt}  截止: ${state.deadline}  ${timing}`,
  ].join('\n');
}

export function registerAgentCommands(program: Command) {
  const agent = program
    .command('agent')
    .description('Let a local AI agent pull good7ob AI tasks (single work slot per machine)');

  agent
    .command('listen')
    .description('Poll the AI task queue, claim one task at a time and hand it to the local agent')
    .option('--interval <seconds>', 'Polling interval in seconds (overrides agent.intervalSeconds)')
    .option('--once', 'Run a single round and exit')
    .action(async (opts) => {
      let cfg: AgentConfig;
      try {
        cfg = loadConfig();
        if (opts.interval !== undefined) cfg = resolveAgentConfig({ ...configService.get('agent'), intervalSeconds: opts.interval });
        requireForward(cfg);
      } catch (e) {
        fail('agent 配置无效', e);
      }
      const { url, secret, command } = cfg.forward;
      const forward = url
        ? (t: ForwardTask) => forwardWebhook(url, secret as string, t)
        : (t: ForwardTask) => forwardCommand(command as string, t);
      const log = (m: string) => console.log(stamp(m));
      const d = deps(cfg, new AgentStateStore(), log);

      let stopping = false;
      let wake = () => undefined as void;
      const stop = () => {
        stopping = true;
        log('收到退出信号，退出（当前任务不退回）');
        wake();
      };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);

      log(`开始监听 AI 任务队列（间隔 ${cfg.intervalSeconds}s，转交: ${url ? `webhook ${url}` : 'command'}${cfg.projectId ? `，项目 ${cfg.projectId}` : ''}）`);
      let lastKind = '';
      while (!stopping) {
        try {
          const r = await runRound(d, forward);
          // busy / empty repeat every round; only say so when it changes.
          if (r.kind !== lastKind && (r.kind === 'busy' || r.kind === 'empty')) {
            log(r.kind === 'busy' ? describeSlot(r.state) : '队列为空，等待新任务');
          }
          lastKind = r.kind;
        } catch (e) {
          log(`本轮失败: ${msgOf(e)}`);
          lastKind = '';
        }
        if (opts.once || stopping) break;
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, cfg.intervalSeconds * 1000);
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
      }
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
    });

  agent
    .command('next')
    .description(`Claim the next task for the calling agent (exit ${EXIT_BUSY}: slot busy, ${EXIT_EMPTY}: queue empty)`)
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      let r;
      try {
        r = await runRound(deps(loadConfig(), new AgentStateStore(), (m) => console.error(m)));
      } catch (e) {
        fail('领取任务失败', e);
      }
      if (r.kind === 'empty') {
        console.log(opts.json ? JSON.stringify({ status: 'empty' }) : '队列为空，没有可领取的任务');
        process.exit(EXIT_EMPTY);
      }
      if (r.kind === 'busy') {
        console.log(opts.json ? JSON.stringify(r.state, null, 2) : `本机已有任务在处理，不领取新任务:\n${describeSlot(r.state)}`);
        process.exit(EXIT_BUSY);
      }
      if (r.kind === 'claimed') {
        console.log(opts.json ? JSON.stringify({ slot: r.state, task: r.task }, null, 2) : `✓ 已领取:\n${describeSlot(r.state)}`);
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
    .description('Show the local work slot and effective agent config')
    .action(() => {
      try {
        const cfg = loadConfig();
        const { url, secret, command } = cfg.forward;
        console.log(`工作槽: ${describeSlot(new AgentStateStore().read())}`);
        console.log('配置:');
        console.log(`  intervalSeconds: ${cfg.intervalSeconds}`);
        console.log(`  expectedMinutes: ${cfg.expectedMinutes}`);
        console.log(`  graceMinutes:    ${cfg.graceMinutes}`);
        console.log(`  projectId:       ${cfg.projectId ?? '(全部)'}`);
        console.log(`  forward.url:     ${url || '(not set)'}`);
        console.log(`  forward.secret:  ${secret ? '(set)' : '(not set)'}`);
        console.log(`  forward.command: ${command || '(not set)'}`);
      } catch (e) {
        fail('读取 agent 状态失败', e);
      }
    });

  agent
    .command('reset')
    .description('Force the local slot back to idle')
    .option('--release', 'Release the current task back to the queue first')
    .action(async (opts) => {
      try {
        const store = new AgentStateStore();
        await store.withLock(async () => {
          // A corrupt state file must still be resettable, so don't let read() block a plain reset.
          let cur: AgentState = IDLE;
          try {
            cur = store.read();
          } catch (e) {
            if (opts.release) throw e;
          }
          if (opts.release && cur.status !== 'idle') {
            const r = await releaseTask(apiClient, cur.taskId, '本机 agent 手动 reset 退回');
            console.log(`✓ 任务 #${cur.taskId} 已退回（${r?.status ?? '-'}）`);
          }
          store.write(IDLE);
        });
        console.log('✓ 本地工作槽已重置为 idle');
      } catch (e) {
        fail('重置失败', e);
      }
    });

  return agent;
}

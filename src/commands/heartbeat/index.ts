import { Command } from 'commander';
import { spawn } from 'child_process';
import apiClient from '../../services/ApiClient';
import { InputError, parseId } from '../../utils/cliHelpers';
import { AgentStateStore } from '../agent/state';
import {
  HEARTBEAT_PATH,
  HeartbeatRunner,
  heartbeatPayload,
  isFatalAuth,
  offlinePath,
  parseEnvTags,
  parseSlots,
  stopStepIdsOf,
} from '../agent/runner';
import { BeatResult, runLoop } from './loop';
import { LoopEntry, isPidAlive, liveEntries, readEntry, removeEntry, writeEntry } from './state';

const PATH = HEARTBEAT_PATH;
export const INTERVAL_MS = 30_000;

const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface BeatOutcome {
  result: BeatResult;
  message?: string;
  /** prd-0136 n4 §5.2: steps the backend wants this runner to stop (already released server-side). */
  stopStepIds: number[];
}

/**
 * A 401/403/404 (key rejected, or a backend without the endpoint) or the "AI employee key only" refusal will never
 * succeed; anything else (network, 5xx, Redis hiccup) may. With `runner` the beat also renews the runner's online
 * key and leases (rp-auto-sched-0010 ~ 0012); without it, it is the plain employee heartbeat as before.
 */
export async function sendBeat(runner?: HeartbeatRunner): Promise<BeatOutcome> {
  try {
    const data = await apiClient.post(PATH, heartbeatPayload(runner));
    return { result: 'ok', stopStepIds: stopStepIdsOf(data) };
  } catch (e) {
    const message = msgOf(e);
    return { result: isFatalAuth(e) ? 'fatal' : 'retry', message, stopStepIds: [] };
  }
}

function agentPidOf(raw: string | undefined): number {
  return parseId(raw, '--pid');
}

function die(e: unknown): never {
  console.error(`✗ ${e instanceof InputError ? e.message : msgOf(e)}`);
  process.exit(1);
}

/**
 * Runner fields from the flags. `--runner-id` alone names a runner; `--slots` / `--env` without it fall back to
 * the registration `agent listen` left in ~/.good7ob/agent-state.json. No flags -> plain employee heartbeat.
 */
export function runnerFromFlags(
  o: { runnerId?: string; slots?: string; env?: string },
  registered: () => { runnerId: number; runnerKey: string } | null
): HeartbeatRunner | undefined {
  const slots = o.slots !== undefined ? parseSlots(o.slots) : undefined;
  const envTags = o.env !== undefined ? parseEnvTags(o.env) : undefined;
  if (o.runnerId === undefined) {
    if (slots === undefined && envTags === undefined) return undefined;
    const reg = registered();
    if (!reg) throw new InputError('--slots / --env 需要指定 --runner-id，或先用 good7ob agent listen 注册 Runner');
    return { runnerId: reg.runnerId, runnerKey: reg.runnerKey, slots, envTags };
  }
  const runnerId = parseId(o.runnerId, '--runner-id');
  const reg = registered();
  return { runnerId, runnerKey: reg && reg.runnerId === runnerId ? reg.runnerKey : undefined, slots, envTags };
}

function registeredRunner(): { runnerId: number; runnerKey: string } | null {
  try {
    return new AgentStateStore().readRunner();
  } catch {
    return null;
  }
}

const runnerArgs = (r?: HeartbeatRunner): string[] => [
  ...(r?.runnerId != null ? ['--runner-id', String(r.runnerId)] : []),
  ...(r?.runnerKey ? ['--runner-key', r.runnerKey] : []),
  ...(r?.slots != null ? ['--slots', String(r.slots)] : []),
  ...(r?.envTags ? ['--env', r.envTags.join(',')] : []),
];

export function describeLoop(l: LoopEntry): string {
  const r = l.runner;
  const runner = r
    ? `  runner ${r.runnerId != null ? `#${r.runnerId}` : r.runnerKey ?? '-'}${r.slots != null ? `  slots ${r.slots}` : ''}${r.envTags ? `  env ${r.envTags.join(',') || '(无)'}` : ''}`
    : '';
  return `agent ${l.agentPid}  loop ${l.loopPid}  自 ${l.startedAt}${runner}`;
}

/**
 * `good7ob heartbeat` — tell good7ob this AI employee's local agent is alive, so the workspace shows it as
 * working instead of idle. Needs an AI-employee key (the employee comes from the key).
 */
export function registerHeartbeatCommands(program: Command) {
  const hb = program
    .command('heartbeat')
    .description('Report that the local agent is alive (AI-employee key): start/stop a background loop, or beat once');

  const withRunnerFlags = (c: Command) =>
    c
      .option('--runner-id <id>', 'Runner to beat for (default: the one agent listen registered, when --slots/--env are given)')
      .option('--slots <n>', 'Update the runner slots (1-8) with this heartbeat')
      .option('--env <tags>', 'Update the runner env tags (dev,test,prod) with this heartbeat');

  withRunnerFlags(hb.command('start'))
    .description('Beat now, then keep beating every 30s in the background until the agent process exits')
    .option('--pid <pid>', 'Agent process to watch (default: parent process)', String(process.ppid))
    .action(async (o) => {
      try {
        const agentPid = agentPidOf(o.pid);
        const runner = runnerFromFlags(o, registeredRunner);
        const existing = readEntry(agentPid);
        if (existing && isPidAlive(existing.loopPid)) {
          console.log(`心跳已在运行（loop pid ${existing.loopPid}，监视 ${agentPid}）`);
          return;
        }
        const first = await sendBeat(runner);
        if (first.result === 'fatal') die(`心跳被拒绝: ${first.message}（需要 AI 员工 Key）`);
        const child = spawn(
          process.execPath,
          [process.argv[1], 'heartbeat', '_run', '--pid', String(agentPid), ...runnerArgs(runner)],
          { detached: true, stdio: 'ignore' }
        );
        child.unref();
        writeEntry({ agentPid, loopPid: child.pid as number, startedAt: new Date().toISOString(), runner });
        const where = runner ? `，Runner ${runner.runnerId != null ? `#${runner.runnerId}` : runner.runnerKey}` : '';
        console.log(`✓ 心跳已启动（监视 ${agentPid}，每 ${INTERVAL_MS / 1000}s${where}）${first.result === 'retry' ? `；首次上报失败将自动重试: ${first.message}` : ''}`);
        if (first.stopStepIds.length) console.log(`! 后端要求停止步骤: ${first.stopStepIds.join(', ')}`);
      } catch (e) {
        die(e);
      }
    });

  // internal: the detached loop `start` spawns
  hb.command('_run', { hidden: true })
    .requiredOption('--pid <pid>')
    .option('--runner-id <id>')
    .option('--runner-key <key>')
    .option('--slots <n>')
    .option('--env <tags>')
    .action(async (o) => {
      const agentPid = agentPidOf(o.pid);
      const runner: HeartbeatRunner | undefined =
        o.runnerId !== undefined || o.runnerKey
          ? {
              runnerId: o.runnerId !== undefined ? parseId(o.runnerId, '--runner-id') : undefined,
              runnerKey: o.runnerKey,
              slots: o.slots !== undefined ? parseSlots(o.slots) : undefined,
              envTags: o.env !== undefined ? parseEnvTags(o.env) : undefined,
            }
          : undefined;
      await runLoop({
        beat: async () => (await sendBeat(runner)).result,
        agentAlive: () => isPidAlive(agentPid),
        sleep,
        intervalMs: INTERVAL_MS,
      });
      await finish(agentPid);
    });

  hb.command('stop')
    .description('Stop the loop of this agent; the employee shows idle right away once no other session of it is running')
    .option('--pid <pid>', 'Agent process whose loop to stop (default: parent process)', String(process.ppid))
    .action(async (o) => {
      try {
        const agentPid = agentPidOf(o.pid);
        const entry = readEntry(agentPid);
        if (entry && entry.loopPid !== process.pid && isPidAlive(entry.loopPid)) process.kill(entry.loopPid, 'SIGTERM');
        await finish(agentPid);
        console.log('✓ 心跳已停止');
      } catch (e) {
        die(e);
      }
    });

  withRunnerFlags(hb.command('beat'))
    .description('Send a single heartbeat (debugging)')
    .option('--json', 'Output as JSON')
    .action(async (o) => {
      let runner: HeartbeatRunner | undefined;
      try {
        runner = runnerFromFlags(o, registeredRunner);
      } catch (e) {
        die(e);
      }
      const { result, message, stopStepIds } = await sendBeat(runner);
      if (result !== 'ok') die(`心跳失败: ${message}`);
      if (o.json) return console.log(JSON.stringify({ status: 'ok', runner: runner ?? null, stopStepIds }, null, 2));
      console.log(`✓ 心跳已上报${runner ? `（Runner ${runner.runnerId != null ? `#${runner.runnerId}` : runner.runnerKey}）` : ''}`);
      if (stopStepIds.length) console.log(`! 后端要求停止步骤: ${stopStepIds.join(', ')}`);
    });

  hb.command('status')
    .description('List heartbeat loops running on this machine (with the runner each one beats for)')
    .option('--json', 'Output as JSON')
    .action((o) => {
      const loops = liveEntries();
      if (o.json) return console.log(JSON.stringify(loops, null, 2));
      if (!loops.length) return console.log('没有运行中的心跳');
      loops.forEach((l) => console.log(describeLoop(l)));
    });
}

/**
 * Forget this agent's loop. A runner loop always tells the backend it is gone (its unclaimed leases go back to the
 * pool, rp-auto-sched-0013); the plain employee offline is sent only when no other loop on this machine is left.
 */
export async function finish(agentPid: number, runner?: HeartbeatRunner): Promise<void> {
  const entry = readEntry(agentPid);
  const r = runner ?? entry?.runner;
  removeEntry(agentPid);
  const othersLeft = liveEntries().some((l) => l.agentPid !== agentPid);
  if (!r && othersLeft) return;
  try {
    await apiClient.delete(r ? offlinePath(r) : PATH);
  } catch {
    // best effort: without it the 90s TTL on the backend turns the employee / runner idle anyway
  }
}

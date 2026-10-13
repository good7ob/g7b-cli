import { Command } from 'commander';
import { spawn } from 'child_process';
import apiClient from '../../services/ApiClient';
import { InputError, parseId } from '../../utils/cliHelpers';
import { BeatResult, runLoop } from './loop';
import { isPidAlive, liveEntries, readEntry, removeEntry, writeEntry } from './state';

const PATH = '/api/v1/me/heartbeat';
const INTERVAL_MS = 30_000;

const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A 401/403/404 (key rejected, or a backend without the endpoint) or the "AI employee key only" refusal will never succeed; anything else (network, 5xx, Redis hiccup) may. */
export async function sendBeat(): Promise<{ result: BeatResult; message?: string }> {
  try {
    await apiClient.post(PATH);
    return { result: 'ok' };
  } catch (e) {
    const message = msgOf(e);
    const status = (e as { status?: number }).status;
    const fatal = status === 401 || status === 403 || status === 404 || message.includes('仅 AI 员工');
    return { result: fatal ? 'fatal' : 'retry', message };
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
 * `good7ob heartbeat` — tell good7ob this AI employee's local agent is alive, so the workspace shows it as
 * working instead of idle. Needs an AI-employee key (the employee comes from the key).
 */
export function registerHeartbeatCommands(program: Command) {
  const hb = program
    .command('heartbeat')
    .description('Report that the local agent is alive (AI-employee key): start/stop a background loop, or beat once');

  hb.command('start')
    .description('Beat now, then keep beating every 30s in the background until the agent process exits')
    .option('--pid <pid>', 'Agent process to watch (default: parent process)', String(process.ppid))
    .action(async (o) => {
      try {
        const agentPid = agentPidOf(o.pid);
        const existing = readEntry(agentPid);
        if (existing && isPidAlive(existing.loopPid)) {
          console.log(`心跳已在运行（loop pid ${existing.loopPid}，监视 ${agentPid}）`);
          return;
        }
        const first = await sendBeat();
        if (first.result === 'fatal') die(`心跳被拒绝: ${first.message}（需要 AI 员工 Key）`);
        const child = spawn(process.execPath, [process.argv[1], 'heartbeat', '_run', '--pid', String(agentPid)], {
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
        writeEntry({ agentPid, loopPid: child.pid as number, startedAt: new Date().toISOString() });
        console.log(`✓ 心跳已启动（监视 ${agentPid}，每 ${INTERVAL_MS / 1000}s）${first.result === 'retry' ? `；首次上报失败将自动重试: ${first.message}` : ''}`);
      } catch (e) {
        die(e);
      }
    });

  // internal: the detached loop `start` spawns
  hb.command('_run', { hidden: true })
    .requiredOption('--pid <pid>')
    .action(async (o) => {
      const agentPid = agentPidOf(o.pid);
      await runLoop({
        beat: async () => (await sendBeat()).result,
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

  hb.command('beat')
    .description('Send a single heartbeat (debugging)')
    .action(async () => {
      const { result, message } = await sendBeat();
      if (result === 'ok') return console.log('✓ 心跳已上报');
      die(`心跳失败: ${message}`);
    });

  hb.command('status')
    .description('List heartbeat loops running on this machine')
    .action(() => {
      const loops = liveEntries();
      if (!loops.length) return console.log('没有运行中的心跳');
      loops.forEach((l) => console.log(`agent ${l.agentPid}  loop ${l.loopPid}  自 ${l.startedAt}`));
    });
}

/** Forget this agent's loop; mark the employee offline only when no other loop on this machine is left. */
async function finish(agentPid: number): Promise<void> {
  removeEntry(agentPid);
  if (liveEntries().some((l) => l.agentPid !== agentPid)) return;
  try {
    await apiClient.delete(PATH);
  } catch {
    // best effort: without it the 90s TTL on the backend turns the employee idle anyway
  }
}

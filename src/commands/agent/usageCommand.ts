/**
 * `good7ob agent report-usage` — upload the token usage of the current Claude Code session to the
 * task the local agent is working on. Two ways in, one code path:
 *   - Stop hook:  `report-usage --hook` (reads the hook JSON from stdin, never fails the agent)
 *   - fallback:   `report-usage` by hand when the hook did not fire / failed (see <data dir>/usage-hook/hook.log)
 * `install-hook` adds the Stop hook to a Claude Code settings.json.
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import apiClient from '../../services/ApiClient';
import { describeError, InputError, parseId } from '../../utils/cliHelpers';
import { buildEffortBody } from '../pm/task/time';
import { AgentStateStore } from './state';
import {
  findLatestTranscript, parseTranscript, toEffortOptions, traceTasks, UsageMemo, UsageTarget, usageSessionKey, withStopHook,
} from './usage';

const readStdin = (): string => {
  try {
    return fs.readFileSync(0, 'utf-8');
  } catch {
    return ''; // no stdin attached (manual run)
  }
};

const sessionIdOf = (transcript: string) => path.basename(transcript, '.jsonl');

function resolveTarget(opts: { task?: string; since?: string }, sessionId: string, cwd: string, memo: UsageMemo): UsageTarget | undefined {
  const sinceOpt = opts.since !== undefined ? Date.parse(opts.since) : undefined;
  if (sinceOpt !== undefined && Number.isNaN(sinceOpt)) throw new InputError(`--since 不是合法时间: ${opts.since}`);
  if (opts.task !== undefined) {
    const remembered = memo.read(sessionId);
    const taskId = parseId(opts.task, 'task');
    return { taskId, sinceMs: sinceOpt ?? (remembered?.taskId === taskId ? remembered.sinceMs : 0) };
  }
  const slot = new AgentStateStore().read();
  if (slot.status !== 'idle') return { taskId: slot.taskId, sinceMs: sinceOpt ?? Date.parse(slot.claimedAt) };
  const remembered = memo.read(sessionId); // slot already freed by `agent done`; the last turn still belongs to that task
  if (remembered) return remembered;
  // Not claimed through `agent next` (e.g. /gjob-exc-task <id>): fall back to the task trace.sh saw in this session.
  const tasks = traceTasks(cwd, sessionId);
  if (tasks.length === 1) return { taskId: tasks[0], sinceMs: sinceOpt ?? 0 };
  if (tasks.length > 1) throw new InputError(`会话涉及多个任务（${tasks.join('、')}），无法判断归属，用 --task <id> 指定`);
  return undefined;
}

export async function reportUsage(
  opts: { hook?: boolean; transcript?: string; session?: string; task?: string; since?: string; dryRun?: boolean },
  memo: UsageMemo = new UsageMemo()
): Promise<string> {
  let transcript = opts.transcript;
  let cwd = process.cwd();
  if (opts.hook) {
    const payload = JSON.parse(readStdin() || '{}');
    transcript = payload.transcript_path ?? transcript;
    cwd = payload.cwd ?? cwd;
  }
  transcript = transcript ?? findLatestTranscript(cwd);
  if (!transcript || !fs.existsSync(transcript)) throw new InputError(`找不到 transcript（${transcript ?? cwd}），用 --transcript <路径> 指定`);

  const sessionId = opts.session ?? sessionIdOf(transcript);
  const target = resolveTarget(opts, sessionId, cwd, memo);
  if (!target) return '本机没有进行中的任务，跳过（需要时用 --task <id> 指定）';

  const usage = parseTranscript(fs.readFileSync(transcript, 'utf-8'), target.sinceMs);
  if (usage.messageCount === 0) return `任务 #${target.taskId} 在该会话中没有 token 记录，跳过`;

  const body = buildEffortBody(toEffortOptions(usage, target.taskId, usageSessionKey(sessionId, target.taskId)));
  const summary = `任务 #${target.taskId} 输入 ${usage.inputTokens} 输出 ${usage.outputTokens} 缓存读 ${usage.cacheReadTokens} 缓存写 ${usage.cacheWriteTokens}（${usage.modelCode ?? '未知模型'}，${usage.messageCount} 次调用）`;
  if (opts.dryRun) return `[dry-run] ${summary}\n${JSON.stringify(body, null, 2)}`;
  await apiClient.post('/progress/efforts', body);
  memo.write(sessionId, target);
  return `✓ 已上报 ${summary}`;
}

export function registerUsageCommands(agent: Command) {
  agent
    .command('report-usage')
    .description('Upload this Claude Code session\'s token usage to the current task (Stop hook; also the manual fallback)')
    .option('--hook', 'Run as a Claude Code hook: read the hook JSON from stdin, never exit non-zero, log failures')
    .option('--transcript <path>', 'Transcript .jsonl (default: newest one of the current directory\'s project)')
    .option('--session <id>', 'Session id used for idempotency (default: transcript file name)')
    .option('--task <id>', 'Task id (default: the task in the local work slot)')
    .option('--since <time>', 'Only count messages after this time (default: when the task was claimed)')
    .option('--dry-run', 'Print what would be uploaded')
    .action(async (opts) => {
      const memo = new UsageMemo();
      try {
        const msg = await reportUsage(opts, memo);
        if (opts.hook) memo.log(msg);
        else console.log(msg);
      } catch (e) {
        const msg = describeError(e);
        if (opts.hook) {
          // A broken hook must not block or confuse the agent; the log tells how to re-run by hand.
          memo.log(`上报失败: ${msg}（兜底: good7ob agent report-usage）`);
          return;
        }
        console.error(`✗ 上报 token 用量失败: ${msg}`);
        process.exit(1);
      }
    });

  agent
    .command('install-hook')
    .description('Add the token-usage Stop hook to Claude Code settings (idempotent)')
    .option('--project', 'Write to ./.claude/settings.json instead of ~/.claude/settings.json')
    .option('--cli <name>', 'Command name the hook runs (default good7ob; a dev install uses its own, e.g. good7ob-dev)', 'good7ob')
    .action((opts) => {
      if (!/^[A-Za-z0-9._-]+$/.test(opts.cli)) {
        console.error(`✗ --cli 只能是命令名（字母、数字、. _ -），收到: ${opts.cli}`);
        process.exit(1);
      }
      const command = `${opts.cli} agent report-usage --hook`;
      const file = opts.project ? path.join(process.cwd(), '.claude', 'settings.json') : path.join(os.homedir(), '.claude', 'settings.json');
      try {
        let current: any = {};
        if (fs.existsSync(file)) {
          try {
            current = JSON.parse(fs.readFileSync(file, 'utf-8'));
          } catch (e) {
            throw new Error(`${file} 不是合法 JSON，未修改: ${(e as Error).message}`);
          }
        }
        const { settings, changed } = withStopHook(current, command);
        if (!changed) return void console.log(`✓ 已安装，无需改动（${file}）`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
        console.log(`✓ 已添加 Stop hook（${file}）: ${command}`);
      } catch (e) {
        console.error(`✗ 安装 hook 失败: ${(e as Error).message}`);
        process.exit(1);
      }
    });
}

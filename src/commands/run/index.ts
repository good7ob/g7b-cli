/**
 * `good7ob run` (prd-0137 FP-3 / FP-4 / FP-6 / FP-7, design n3 §7, backend #992): automation runs and their steps.
 *
 * Runner side (AI employee key holding the step): `log append`, `step done | fail`, `tool-calls append`,
 * `files report`, `artifacts add` under `/api/v1/orgs/{orgId}/runs/{runId}/steps/{stepId}/…`. `--run / --step` default
 * to the busy local slot (`~/.good7ob/agent-state.json`, written by `agent listen / next` when an assigned item was
 * claimed); the slot also keeps the log seq counter and is freed by `step done / fail` of its step.
 *
 * Human side: `list`, `show`, `logs [--follow]`, `pause | resume | halt | cancel | abandon` (version read first),
 * `step retry | reassign`.
 */

import * as fs from 'fs';
import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { InputError, collect, emit, parseId, parseIntInRange, requireOneOf } from '../../utils/cliHelpers';
import { extractRecords } from '../../utils/extractRecords';
import { AgentStateStore } from '../agent/state';
import {
  FILES_MAX, FileItem, OPERATIONS, Operation, RUN_STATUSES, StepTarget, artifactItem, batches, describeRunError, doneBody,
  failBody, operationBody, parseFilesJson, versionOf, parseSeq, parseToolCallsJsonl, resolveTarget, runBase, stepBase, stepLost,
} from './input';
import { pickStep, renderEvent, renderRunDetail, renderRunList, renderSegments } from './render';
import { Git, LogUploadError, appendLog, describeFinish, finishStep, gitDiffSummary, realGit, resolveOrg } from './steps';

/** Indirections so tests drive stdin, files, git and the --follow loop without real I/O or time. */
export const io = {
  readStdin: (): string => fs.readFileSync(0, 'utf-8'),
  readFile: (p: string): string => fs.readFileSync(p, 'utf-8'),
  fileSize: (p: string): number => fs.statSync(p).size,
  git: realGit as Git,
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

/** PRD: the runner buffers at most 100 MB locally. */
const LOCAL_BUFFER_MAX = 100 * 1024 * 1024;
const FOLLOW_SECONDS = 10;

function failRun(prefix: string, error: unknown): never {
  if (error instanceof InputError) {
    console.error(`✗ 参数错误: ${error.message}`);
  } else {
    console.error(`✗ ${prefix}: ${describeRunError(error)}`);
    // a retry only makes sense when part of the log got through or the failure was transport-level
    if (error instanceof LogUploadError && (error.sent > 0 || typeof (error as { code?: unknown }).code !== 'number')) {
      console.error(`  已上传 ${error.sent} 段；失败于 seq ${error.failedSeq}。重试: 原命令加 --seq ${error.firstSeq}（同 seq 幂等，已存的段不会重复写入）`);
    }
    if (stepLost(error)) console.error('  若本地工作槽仍记着该步骤（good7ob agent status），确认后用 good7ob agent reset --keep-runner 清空');
  }
  process.exit(1);
}

async function guard(prefix: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    failRun(prefix, e);
  }
}

type TargetOpts = { run?: string; step?: string; orgId?: string; json?: boolean };

const targetOptions = (cmd: Command) =>
  cmd
    .option('--run <id>', '运行 ID（默认取本地工作槽正在执行的运行）')
    .option('--step <id>', '步骤 ID（默认取本地工作槽正在执行的步骤）')
    .option('--org-id <id>', '组织 ID（默认: 工作槽记录的组织 / GOOD7OB_ORG_ID / config set org-id / Key 唯一所属组织）')
    .option('--json', '输出 JSON');

async function target(o: TargetOpts, store = new AgentStateStore()): Promise<{ t: StepTarget; orgId: number; store: AgentStateStore }> {
  const slot = store.read();
  const t = resolveTarget(o, slot);
  const orgId = await resolveOrg(apiClient, o.orgId, t.orgId, slot.status !== 'idle' ? slot.orgId : undefined);
  return { t, orgId, store };
}

const orgOption = (cmd: Command) =>
  cmd.option('--org-id <id>', '组织 ID（默认 GOOD7OB_ORG_ID / config set org-id / Key 唯一所属组织）').option('--json', '输出 JSON');

/** Reads the log text from exactly one of --file / --stdin / --text. */
function logText(o: { file?: string; stdin?: boolean; text?: string }): string {
  const given = [o.file !== undefined, !!o.stdin, o.text !== undefined].filter(Boolean).length;
  if (given !== 1) throw new InputError('日志来源必须且只能给一个: --file <path> | --stdin | --text "…"');
  if (o.text !== undefined) return o.text;
  if (o.stdin) return io.readStdin();
  const file = o.file as string;
  let size: number;
  try {
    size = io.fileSize(file);
  } catch (e) {
    throw new InputError(`无法读取 --file ${file}: ${(e as Error).message}`);
  }
  if (size > LOCAL_BUFFER_MAX) throw new InputError(`--file 超过本地缓冲上限 100 MB（${size} 字节），请先切分`);
  return io.readFile(file);
}

function readJsonArg(raw: string): string {
  if (!raw.startsWith('@')) return raw;
  try {
    return io.readFile(raw.slice(1));
  } catch (e) {
    throw new InputError(`无法读取 ${raw.slice(1)}: ${(e as Error).message}`);
  }
}

/** Files of a report: `--from-git <base>` (git diff) or `--files <json|@file>`; never file contents. */
function collectFiles(o: { fromGit?: string; files?: string }, prUrl?: string): { files?: FileItem[]; branch?: string; commitRange?: string } {
  if (o.fromGit !== undefined && o.files !== undefined) throw new InputError('--from-git 与 --files 只能二选一');
  if (o.fromGit !== undefined) return gitDiffSummary(io.git, o.fromGit, prUrl);
  if (o.files !== undefined) {
    const files = parseFilesJson(readJsonArg(o.files));
    return { files: prUrl ? files.map((f) => ({ ...f, prUrl: f.prUrl ?? prUrl })) : files };
  }
  return {};
}

function warnFilesCap(files: FileItem[] | undefined): void {
  if (files && files.length > FILES_MAX) console.error(`! 共 ${files.length} 个文件，服务端每步只保存前 ${FILES_MAX} 个并标记「清单截断」`);
}

export function registerRunCommands(program: Command) {
  const run = program.command('run').description('Automation runs and steps (prd-0137): runner reports (log / done / fail / tool calls / files / artifacts) and human reads / operations');

  // ───────────────────────────── human: reads

  orgOption(
    run
      .command('list')
      .description('List automation runs visible to you (default: last 90 days)')
      .option('--automation <id>', '只看某个自动化')
      .option('--project <id>', '只看某个项目')
      .option('--status <status>', `状态 ${RUN_STATUSES.join('|')}`)
      .option('--page <n>', '页码', '1')
      .option('--page-size <n>', '每页条数 1-100', '20')
  ).action((o) =>
    guard('查询运行失败', async () => {
      const orgId = await resolveOrg(apiClient, o.orgId);
      const params: Record<string, unknown> = { page: parseIntInRange(o.page, '--page', 1, 100000), pageSize: parseIntInRange(o.pageSize, '--page-size', 1, 100) };
      if (o.automation !== undefined) params.automationId = parseId(o.automation, '--automation');
      if (o.project !== undefined) params.projectId = parseId(o.project, '--project');
      if (o.status !== undefined) params.status = requireOneOf(String(o.status).toLowerCase(), RUN_STATUSES, '--status');
      const data = await apiClient.get(runBase(orgId), params);
      emit(o.json, data, () => renderRunList(extractRecords(data), data?.total));
    })
  );

  orgOption(run.command('show <runId>').description('Run detail: header, totals, permissions and steps')).action((id, o) =>
    guard('查询运行失败', async () => {
      const runId = parseId(id, 'runId');
      const orgId = await resolveOrg(apiClient, o.orgId);
      const data = await apiClient.get(`${runBase(orgId)}/${runId}`);
      emit(o.json, data, () => renderRunDetail(data));
    })
  );

  orgOption(
    run
      .command('logs <runId>')
      .description(`Step log of a run (default: the running step, else the last one with logs); --follow polls /stream every ${FOLLOW_SECONDS} s`)
      .option('--step <id>', '步骤 ID')
      .option('--after <seq>', '从该段序号之后读（默认: 最近约 200 KB）')
      .option('--limit <n>', '一次最多读多少段 1-50', '20')
      .option('--follow', `持续跟随（每 ${FOLLOW_SECONDS} 秒轮询，运行终结后退出）`)
  ).action((id, o) =>
    guard('读取日志失败', async () => {
      const runId = parseId(id, 'runId');
      const limit = parseIntInRange(o.limit, '--limit', 1, 50);
      const after = o.after !== undefined ? parseIntInRange(o.after, '--after', 0, 2147483647) : undefined;
      const only = o.step !== undefined ? parseId(o.step, '--step') : undefined;
      const orgId = await resolveOrg(apiClient, o.orgId);
      await showLogs(orgId, runId, { only, after, limit, follow: !!o.follow, json: !!o.json });
    })
  );

  // ───────────────────────────── human: operations

  for (const op of OPERATIONS) {
    const needsReason = op === 'cancel' || op === 'abandon';
    const cmd = run
      .command(`${op} <runId>`)
      .description(
        {
          pause: 'Graceful pause: no new steps, running ones finish (version read first)',
          resume: 'Resume a paused run; force-stopped steps come back as a new attempt',
          halt: 'Forced pause: running steps are cancelled and their runners told to stop',
          cancel: 'Cancel (中止) a non-terminal run; --reason required',
          abandon: 'Abandon a paused run (= cancel); --reason required',
        }[op]
      );
    if (op !== 'pause' && op !== 'resume') cmd.option('--reason <text>', needsReason ? '原因（必填）' : '原因');
    orgOption(cmd).action((id, o) =>
      guard(`run ${op} 失败`, async () => {
        const runId = parseId(id, 'runId');
        if (needsReason && !o.reason?.trim()) throw new InputError(`run ${op} 需要 --reason <原因>`);
        const orgId = await resolveOrg(apiClient, o.orgId);
        const current = await apiClient.get(`${runBase(orgId)}/${runId}`);
        const data = await apiClient.post(`${runBase(orgId)}/${runId}/${op}`, operationBody(op as Operation, current?.version, o.reason));
        emit(o.json, data, () => `✓ 运行 #${runId} 已 ${op}（${current?.status ?? '-'} → ${data?.status ?? '-'}，version ${data?.version ?? '-'}）`);
      })
    );
  }

  // ───────────────────────────── runner: logs

  const log = run.command('log').description('Step log segments (runner)');
  targetOptions(
    log
      .command('append')
      .description('Upload step output as log segments (≤ 1 MB each, masked locally; seq idempotent)')
      .option('--file <path>', '日志文件')
      .option('--stdin', '从标准输入读取')
      .option('--text <text>', '直接给出日志文本')
      .option('--seq <n>', '首段序号（默认: 本地计数器续号；重试失败的上传时用原首段序号）')
  ).action((o) =>
    guard('上传日志失败', async () => {
      const text = logText(o);
      const seq = parseSeq(o.seq);
      const { t, orgId, store } = await target(o);
      const r = await appendLog(apiClient, store, orgId, t, text, seq, (m) => console.error(m));
      emit(o.json, { runId: t.runId, stepId: t.stepId, ...r }, () => {
        const lines = [
          `✓ 运行 #${t.runId} 步骤 #${t.stepId} 日志已上传 ${r.segments} 段（seq ${r.first}${r.last > r.first ? `–${r.last}` : ''}，${r.bytes} 字节${r.totalBytes != null ? `；步骤累计 ${r.totalBytes} 字节` : ''}）`,
        ];
        if (r.duplicates.length) lines.push(`! seq ${r.duplicates.join(', ')} 服务端已存在（幂等，未重复写入）`);
        if (r.truncated) lines.push('! 该步骤日志已被服务端标记截断（达到 50 MB）');
        return lines.join('\n');
      });
    })
  );

  // ───────────────────────────── runner: done / fail; human: retry / reassign

  const step = run.command('step').description('Step completion reports (runner) and step operations (human)');
  targetOptions(
    step
      .command('done')
      .description('Report the step finished (AI employee key holding the step); frees the local slot when it held the step')
      .option('--summary <text>', '完成摘要（≤ 500 字）')
      .option('--result <result>', '完成程度 completed|partial（partial 以 "[partial] " 前缀写入摘要）', 'completed')
      .option('--pr <url>', 'PR 链接（可重复）', collect, [])
      .option('--artifact <type:ref>', '产物 <type>:<id|url>，如 TEST_RUN:7（可重复）', collect, [])
      .option('--tokens <n|json>', '自报 token：总数，或 {"input","output","cacheRead","cacheWrite"}')
      .option('--from-git <base>', '同时上报 git diff <base>...HEAD 的修改文件摘要（只发路径与行数）')
      .option('--files <json|@file>', '同时上报修改文件摘要 JSON 数组')
      .option('--branch <name>', '分支名')
      .option('--commit-range <range>', 'commit 范围，如 abc..def')
  ).action((o) =>
    guard('回报步骤完成失败', async () => {
      const files = collectFiles(o, o.pr?.[0]);
      const body = doneBody({ ...o, branch: o.branch ?? files.branch, commitRange: o.commitRange ?? files.commitRange }, files.files);
      warnFilesCap(files.files);
      const { t, orgId, store } = await target(o);
      const r = await finishStep(apiClient, store, orgId, t, 'done', body);
      emit(o.json, r.data, () => describeFinish('done', t, r));
    })
  );

  targetOptions(
    step
      .command('fail')
      .description('Report the step failed; frees the local slot when it held the step')
      .requiredOption('--reason <text>', '失败原因（文字；或直接给失败码 TEST_FAILED|REVIEW_FAILED|AGENT_ERROR|BLOCKED|OTHER）')
      .option('--message <text>', '补充说明（≤ 500 字）')
      .option('--code <code>', '失败码 TEST_FAILED|REVIEW_FAILED|AGENT_ERROR|BLOCKED|OTHER（TEST_FAILED / REVIEW_FAILED 触发返工）')
      .option('--retryable', '暂时性失败（未给失败码时记为 AGENT_ERROR，否则 OTHER），便于人工 run step retry')
      .option('--artifact <type:ref>', '产物 <type>:<id|url>（可重复）', collect, [])
      .option('--tokens <n|json>', '自报 token')
  ).action((o) =>
    guard('回报步骤失败失败', async () => {
      const body = failBody(o);
      const { t, orgId, store } = await target(o);
      const r = await finishStep(apiClient, store, orgId, t, 'fail', body);
      emit(o.json, r.data, () => describeFinish('fail', t, r));
    })
  );

  orgOption(step.command('retry <runId> <stepId>').description('Retry a failed step (run failed / paused; version read first)')).action((rid, sid, o) =>
    guard('重跑步骤失败', async () => {
      const runId = parseId(rid, 'runId');
      const stepId = parseId(sid, 'stepId');
      const orgId = await resolveOrg(apiClient, o.orgId);
      const current = await apiClient.get(`${runBase(orgId)}/${runId}`);
      const data = await apiClient.post(`${runBase(orgId)}/${runId}/steps/${stepId}/retry`, { version: versionOf(current?.version, 'step retry') });
      emit(o.json, data, () => `✓ 运行 #${runId} 步骤 #${stepId} 已重跑（运行 ${data?.status ?? '-'}，version ${data?.version ?? '-'}）`);
    })
  );

  orgOption(
    step
      .command('reassign <runId> <stepId>')
      .description('Release the step and decide again, or hand it to --employee')
      .option('--employee <id>', '指定 AI 员工（默认由调度器重新决定）')
      .option('--reason <text>', '原因')
  ).action((rid, sid, o) =>
    guard('改派步骤失败', async () => {
      const runId = parseId(rid, 'runId');
      const stepId = parseId(sid, 'stepId');
      const body: Record<string, unknown> = {};
      if (o.employee !== undefined) body.employeeId = parseId(o.employee, '--employee');
      if (o.reason?.trim()) body.reason = o.reason.trim();
      const orgId = await resolveOrg(apiClient, o.orgId);
      const data = await apiClient.post(`${runBase(orgId)}/${runId}/steps/${stepId}/reassign`, body);
      emit(o.json, data, () => `✓ 步骤 #${stepId} 已改派（${data?.status ?? '-'}${data?.employeeName ? `，${data.employeeName}` : ''}）`);
    })
  );

  // ───────────────────────────── runner: tool calls / files / artifacts

  const tools = run.command('tool-calls').description('Tool call timeline (runner)');
  targetOptions(
    tools
      .command('append')
      .description('Upload tool calls from a JSONL file: {tool, startedAt, durationMs, ok, note} per line (≤ 500 per request)')
      .requiredOption('--file <jsonl>', 'JSONL 文件')
  ).action((o) =>
    guard('上传工具调用失败', async () => {
      const items = parseToolCallsJsonl(readJsonArg(`@${o.file}`));
      if (!items.length) throw new InputError(`${o.file} 没有工具调用记录`);
      const { t, orgId } = await target(o);
      let stored = 0;
      for (const batch of batches(items)) {
        const r = await apiClient.post(`${stepBase(orgId, t)}/tool-calls`, { items: batch });
        stored += Number(r?.stored ?? batch.length);
      }
      emit(o.json, { runId: t.runId, stepId: t.stepId, stored }, () => `✓ 运行 #${t.runId} 步骤 #${t.stepId} 已上传 ${stored} 条工具调用`);
    })
  );

  const files = run.command('files').description('Changed-file summary (runner)');
  targetOptions(
    files
      .command('report')
      .description('Report changed files: paths and added / deleted line counts only, never contents')
      .option('--from-git <base>', '用 git diff --numstat <base>...HEAD 计算（已提交的改动）')
      .option('--files <json|@file>', '直接给出 JSON 数组 [{path, changeType, linesAdded, linesDeleted}]')
      .option('--pr <url>', 'PR 链接（写入每条记录）')
      .option('--branch <name>', '分支名（--from-git 时默认当前分支）')
      .option('--commit-range <range>', 'commit 范围（--from-git 时默认 merge-base..HEAD）')
  ).action((o) =>
    guard('上报修改文件失败', async () => {
      if (o.fromGit === undefined && o.files === undefined) throw new InputError('需要 --from-git <base> 或 --files <json|@file>');
      const f = collectFiles(o, o.pr);
      if (!f.files?.length) {
        emit(o.json, { stored: 0 }, () => '没有修改文件，未上报');
        return;
      }
      warnFilesCap(f.files);
      const body: Record<string, unknown> = { files: f.files };
      if (o.pr) body.prUrl = o.pr;
      const branch = o.branch ?? f.branch;
      const commitRange = o.commitRange ?? f.commitRange;
      if (branch) body.branch = branch;
      if (commitRange) body.commitRange = commitRange;
      const { t, orgId } = await target(o);
      const r = await apiClient.post(`${stepBase(orgId, t)}/files`, body);
      const added = f.files.reduce((n, x) => n + x.linesAdded, 0);
      const deleted = f.files.reduce((n, x) => n + x.linesDeleted, 0);
      emit(o.json, r, () => `✓ 运行 #${t.runId} 步骤 #${t.stepId} 已上报 ${r?.stored ?? f.files?.length} 个文件（+${added} −${deleted}）${r?.truncated ? '，清单已截断' : ''}`);
    })
  );

  const artifacts = run.command('artifacts').description('Step artifact references (runner)');
  targetOptions(
    artifacts
      .command('add')
      .description('Attach an artifact reference to the step (idempotent)')
      .requiredOption('--type <type>', 'PR | REVIEW_REPORT | TEST_RUN | EXTERNAL（以及 DELIVERABLE_PACKAGE / GATE_RESULT / ACCEPTANCE_RECORD / RELEASE / DEPLOY_RECORD）')
      .requiredOption('--ref <id|url>', '对象 id 或链接')
      .option('--title <text>', '标题')
  ).action((o) =>
    guard('添加产物失败', async () => {
      const item = artifactItem(o.type, o.ref, o.title);
      const { t, orgId } = await target(o);
      const r = await apiClient.post(`${stepBase(orgId, t)}/artifacts`, item);
      emit(o.json, r, () => `✓ 步骤 #${t.stepId} 产物已关联: ${r?.objectType ?? item.type}${r?.objectId != null ? ` #${r.objectId}` : ''}${r?.externalUrl ? ` ${r.externalUrl}` : ''}${r?.id != null ? `（#${r.id}）` : ''}`);
    })
  );

  return run;
}

// ───────────────────────────── run logs [--follow]

async function showLogs(orgId: number, runId: number, o: { only?: number; after?: number; limit: number; follow: boolean; json: boolean }): Promise<void> {
  const base = `${runBase(orgId)}/${runId}`;
  const steps: any[] = (await apiClient.get(`${base}/steps`)) ?? [];
  const names = new Map<number, string>(steps.map((s) => [Number(s.id), `${s.nodeCode ?? ''}${s.attempt > 1 ? ` 第 ${s.attempt} 次` : ''}`.trim()]));
  const first = o.only ?? pickStep(steps)?.id;
  const out = (s: string) => s && console.log(s);
  let lastHeader: number | undefined;
  const header = (stepId: number) => {
    if (o.json || lastHeader === stepId) return;
    lastHeader = stepId;
    out(`── 步骤 #${stepId}${names.get(stepId) ? ` ${names.get(stepId)}` : ''}`);
  };
  const print = (stepId: number, items: any[]) => {
    if (!items.length) return;
    if (o.json) items.forEach((i) => console.log(JSON.stringify({ stepId, ...i })));
    else {
      header(stepId);
      out(renderSegments(items));
    }
  };

  const cursors = new Map<number, number>();
  if (first == null) {
    if (!o.follow) return out(o.json ? '[]' : '该运行还没有步骤');
  } else {
    const r = await apiClient.get(`${base}/steps/${first}/logs`, o.after !== undefined ? { after: o.after, limit: o.limit } : { limit: o.limit });
    if (!o.follow && o.json) return console.log(JSON.stringify(r, null, 2));
    header(first);
    print(first, r?.items ?? []);
    if (!o.follow && !(r?.items ?? []).length) out(r?.expired ? '(日志已过保留期)' : '(暂无日志)');
    if (r?.truncated && !o.json) out('! 该步骤日志已在 50 MB 处截断');
    cursors.set(first, Number(r?.next ?? 0));
  }
  if (!o.follow) return;

  // initial cursor: skip the run's history of events (≤ 500 per call)
  let since: number | undefined;
  let s: any;
  for (;;) {
    s = await apiClient.get(`${base}/stream`, since != null ? { since } : undefined);
    const n = (s?.events ?? []).length;
    since = s?.next ?? since;
    if (n < 500) break;
  }
  // other steps start at their current end: --follow shows what happens from now on
  for (const st of s?.steps ?? []) {
    const id = Number(st.stepId);
    if (!cursors.has(id)) cursors.set(id, Number(st.lastLogSeq ?? 0));
  }
  if (!o.json) out(`… 跟随运行 #${runId}（每 ${FOLLOW_SECONDS} 秒轮询，Ctrl-C 退出）`);
  for (;;) {
    for (const st of s?.steps ?? []) {
      const id = Number(st.stepId);
      if (o.only != null && id !== o.only) continue;
      const lastSeq = Number(st.lastLogSeq ?? 0);
      let cur = cursors.get(id) ?? 0;
      while (lastSeq > cur) {
        const r = await apiClient.get(`${base}/steps/${id}/logs`, { after: cur, limit: 50 });
        const items = r?.items ?? [];
        if (!items.length) break;
        print(id, items);
        cur = Number(r?.next ?? cur);
      }
      cursors.set(id, cur);
    }
    if (s?.terminal) {
      if (!o.json) out(`运行 #${runId} 已结束（${s.status ?? '-'}）`);
      return;
    }
    const wait = Number(s?.pollAfterSeconds) > 0 ? Number(s.pollAfterSeconds) : FOLLOW_SECONDS;
    await io.sleep(wait * 1000);
    s = await apiClient.get(`${base}/stream`, since != null ? { since } : undefined);
    for (const e of s?.events ?? []) {
      if (o.json) console.log(JSON.stringify({ event: e }));
      else out(renderEvent(e));
    }
    since = s?.next ?? since;
  }
}


/**
 * Requirement-drift guard for tasks. A task records which PRD version it was written against as one line in its
 * description (`需求来源: prd-0004@1.0.11`, the backend does not parse it); `pm task requirement-check` compares that
 * with the PRD's current version and with the backend's requirementChanged/Removed flags, and says so in its exit code:
 * 0 consistent, 3 changed, 4 removed, 5 no source line (cannot tell).
 */

import { Command } from 'commander';
import apiClient from '../../../services/ApiClient';
import { collect, emit, guarded, InputError, parseId } from '../../../utils/cliHelpers';

export const EXIT_CHANGED = 3;
export const EXIT_REMOVED = 4;
export const EXIT_NO_SOURCE = 5;

export interface Source {
  prdNo: string;
  version: string;
}

const SOURCE_LINE = /^\s*需求来源\s*[:：]\s*([^\s@]+)@(\S+)\s*$/;

export function parseSources(description: string | null | undefined): Source[] {
  return (description ?? '').split(/\r?\n/).flatMap((line) => {
    const m = SOURCE_LINE.exec(line);
    return m ? [{ prdNo: m[1], version: m[2] }] : [];
  });
}

/** Replace the line of a PRD already recorded, append the others; every other line of the description stays as it is. */
export function upsertSources(description: string | null | undefined, sources: Source[]): string {
  const pending = new Map(sources.map((s) => [s.prdNo, s]));
  const lines = (description ?? '').split(/\r?\n/).map((line) => {
    const m = SOURCE_LINE.exec(line);
    const next = m && pending.get(m[1]);
    if (!m || !next) return line;
    pending.delete(m[1]);
    return `需求来源: ${next.prdNo}@${next.version}`;
  });
  const added = [...pending.values()].map((s) => `需求来源: ${s.prdNo}@${s.version}`);
  const base = lines.join('\n').replace(/\s+$/, '');
  return [base, ...added].filter((part) => part !== '').join('\n');
}

/** The version the PRD is at now; a missing PRD or one without a document version is an error, never a guess. */
export async function currentPrdVersion(prdNo: string): Promise<string> {
  const res = await apiClient.get('/forge/prd/prds', { keyword: prdNo, page: 1, pageSize: 20 });
  const row = ((res?.list ?? []) as Array<{ prdNo?: string; version?: string | null }>).find((r) => r.prdNo === prdNo);
  if (!row) throw new InputError(`PRD ${prdNo} 不存在（或无权访问）`);
  if (!row.version) throw new InputError(`PRD ${prdNo} 还没有正文版本，无法记录需求来源`);
  return row.version;
}

export async function resolveSources(prdNos: string[]): Promise<Source[]> {
  const unique = [...new Set(prdNos.map((p) => p.trim()))];
  return Promise.all(unique.map(async (prdNo) => ({ prdNo, version: await currentPrdVersion(prdNo) })));
}

export type Verdict = 'consistent' | 'changed' | 'removed' | 'no-source';
const EXIT: Record<Verdict, number> = { consistent: 0, changed: EXIT_CHANGED, removed: EXIT_REMOVED, 'no-source': EXIT_NO_SOURCE };
const LABEL: Record<Verdict, string> = { consistent: '一致', changed: '需求已变更', removed: '需求已被移除', 'no-source': '没有需求来源行，无法判断' };

interface TaskFlags {
  requirementChangedAt?: number | null;
  requirementChangedNote?: string | null;
  requirementRemovedAt?: number | null;
  requirementRemovedNote?: string | null;
}

export function judge(sources: Array<Source & { current: string }>, task: TaskFlags): Verdict {
  if (task.requirementRemovedAt) return 'removed';
  if (task.requirementChangedAt || sources.some((s) => s.version !== s.current)) return 'changed';
  return sources.length === 0 ? 'no-source' : 'consistent';
}

export function registerRequirementCommands(taskCommand: Command) {
  taskCommand
    .command('requirement-check <id>')
    .description('Has the requirement behind this task changed since it was written? Exit: 0 same, 3 changed, 4 removed, 5 no source line')
    .option('--json', 'Output as JSON')
    .action((id: string, o: { json?: boolean }) => {
      let code = 0;
      return guarded('需求核对失败', {}, async () => {
        const taskId = parseId(id, '<id>');
        const task = await apiClient.get(`/progress/tasks/${taskId}`);
        const sources = await Promise.all(parseSources(task.description).map(async (s) => ({ ...s, current: await currentPrdVersion(s.prdNo) })));
        const verdict = judge(sources, task);
        code = EXIT[verdict];
        const result = {
          taskId, verdict, exitCode: code,
          sources: sources.map((s) => ({ prdNo: s.prdNo, recorded: s.version, current: s.current, changed: s.version !== s.current })),
          changedAt: task.requirementChangedAt ?? null, changedNote: task.requirementChangedNote ?? null,
          removedAt: task.requirementRemovedAt ?? null, removedNote: task.requirementRemovedNote ?? null,
        };
        emit(o.json, result, () => [
          `任务 #${taskId} 需求核对：${LABEL[verdict]}`,
          ...result.sources.map((s) => `  ${s.prdNo}  记录 ${s.recorded} → 当前 ${s.current}${s.changed ? '  [已变更]' : ''}`),
          ...(result.changedNote ? [`  变更标记：${result.changedNote}`] : []),
          ...(result.removedNote ? [`  移除标记：${result.removedNote}`] : []),
          ...(verdict === 'no-source' ? ['  用 `pm task update <id> --prd <prdNo>` 补上需求来源'] : []),
        ].join('\n'));
      }).then(() => {
        if (code !== 0) process.exit(code);
      });
    });

  taskCommand
    .command('requirement-ack <id>')
    .description('Acknowledge a requirement change / removal flag on a task (clears it); --rebase also moves the source line to the current PRD version')
    .option('--rebase', 'Also update 需求来源 lines to the current PRD versions (I have read the change and continue on the new version)')
    .action((id: string, o: { rebase?: boolean }) =>
      guarded('确认需求变化失败', {}, async () => {
        const taskId = parseId(id, '<id>');
        if (o.rebase) {
          const task = await apiClient.get(`/progress/tasks/${taskId}`);
          const recorded = parseSources(task.description);
          if (recorded.length === 0) throw new InputError('任务描述里没有需求来源行，无法 --rebase（先用 `pm task update <id> --prd <prdNo>` 补上）');
          const sources = await resolveSources(recorded.map((s) => s.prdNo));
          // description first: if the ack below fails the flag stays set, which is the safe side
          await apiClient.put(`/progress/tasks/${taskId}`, { description: upsertSources(task.description, sources) });
        }
        await apiClient.post(`/progress/tasks/${taskId}/requirement-ack`);
        console.log(`✓ 已确认任务 #${taskId} 的需求变化${o.rebase ? '，需求来源已更新到当前版本' : ''}`);
      }));
}

/** `--prd` option shared by create and update. */
export const prdOption = ['--prd <prdNo>', 'Record the PRD this task is written against as a 需求来源 line (repeatable)', collect] as const;

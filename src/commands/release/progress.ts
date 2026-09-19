import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { emit, fail, parseId } from '../../utils/cliHelpers';
import { MAX_NOTE, PROGRESS_ERROR_CODES, buildNoteBody } from '../pm/health/input';
import { ReleaseBaseline, ReleaseHealth, renderReleaseBaseline, renderReleaseHealth } from './progressRender';

/**
 * Release-level progress (backend ReleaseProgressController, /progress/releases/{id}). Note the
 * different error codes from the rest of `release` (/forge/releases): these use the progress
 * module's 1000/1001/1002/1008/2000. Any org member of the release's product may use them.
 */

const guarded = (prefix: string, fn: () => Promise<void>) => fn().catch((e) => fail(prefix, e, PROGRESS_ERROR_CODES));

export function registerReleaseProgressCommands(release: Command): void {
  release
    .command('health <releaseId>')
    .description('Release-level KPIs: scope, baseline, weighted progress, velocity and ETA (in the product\'s workload basis)')
    .option('--json', 'Output as JSON')
    .action((releaseId, o) =>
      guarded('获取 Release 健康度失败', async () => {
        const h: ReleaseHealth = await apiClient.get(`/progress/releases/${parseId(releaseId, 'releaseId')}/health`);
        emit(o.json, h, () => renderReleaseHealth(h ?? {}));
      }));

  release
    .command('baseline <releaseId>')
    .description('Snapshot the release\'s CURRENT scope as its new baseline (append-only; does not touch the product baseline)')
    .option('--note <text>', `Why (max ${MAX_NOTE} chars)`)
    .option('--json', 'Output as JSON')
    .action((releaseId, o) =>
      guarded('设置 Release 基线失败', async () => {
        const rid = parseId(releaseId, 'releaseId');
        const baseline: ReleaseBaseline = await apiClient.post(`/progress/releases/${rid}/baseline`, buildNoteBody(o.note));
        emit(o.json, baseline, () => renderReleaseBaseline(baseline ?? {}));
      }));
}

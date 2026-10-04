import { renderTable, dash } from '../../utils/cliHelpers';
import { WorktreeEntry, isEntryActive } from '../../services/WorktreeStateService';

function ageString(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return dash(null);
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  return `${Math.floor(hours / 24)}天前`;
}

export function renderWorktreeList(entries: WorktreeEntry[]): string {
  if (entries.length === 0) return '(没有 worktree 占用记录)';
  const rows = [
    ['任务', '路径', '分支', 'PID', '状态', '心跳'],
    ...entries.map((e) => [
      `#${e.taskId}`,
      e.worktreePath,
      dash(e.branch),
      String(e.pid),
      isEntryActive(e) ? '活跃' : '疑似失效',
      ageString(e.heartbeat),
    ]),
  ];
  return renderTable(rows);
}

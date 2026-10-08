/**
 * Which heartbeat loops this machine runs: one JSON file per watched agent pid under
 * `~/.good7ob/heartbeat/`. Two sessions of the same AI employee on one machine each get their own loop,
 * and the employee only goes offline when the last one stops.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface LoopEntry {
  /** The agent process being watched (e.g. Claude Code). */
  agentPid: number;
  /** The detached background loop. */
  loopPid: number;
  startedAt: string;
}

export function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the pid exists but belongs to another user
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

const dir = () => path.join(os.homedir(), '.good7ob', 'heartbeat');
const fileOf = (agentPid: number) => path.join(dir(), `${agentPid}.json`);

export function readEntry(agentPid: number): LoopEntry | null {
  try {
    return JSON.parse(fs.readFileSync(fileOf(agentPid), 'utf-8')) as LoopEntry;
  } catch {
    return null;
  }
}

export function writeEntry(entry: LoopEntry): void {
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(fileOf(entry.agentPid), JSON.stringify(entry));
}

export function removeEntry(agentPid: number): void {
  fs.rmSync(fileOf(agentPid), { force: true });
}

/** Entries whose loop is still running; entries of dead loops are removed on the way. */
export function liveEntries(): LoopEntry[] {
  if (!fs.existsSync(dir())) return [];
  const live: LoopEntry[] = [];
  for (const name of fs.readdirSync(dir())) {
    const agentPid = parseInt(name, 10);
    const entry = Number.isFinite(agentPid) ? readEntry(agentPid) : null;
    if (entry && isPidAlive(entry.loopPid)) live.push(entry);
    else if (Number.isFinite(agentPid)) removeEntry(agentPid);
  }
  return live;
}

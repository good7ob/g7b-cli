/**
 * `good7ob service install | uninstall | status` (g7b #3633): writes the definitions from spec.ts and drives
 * launchctl / systemctl / schtasks. Every system call goes through `Sys` so tests never touch a real service manager.
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { currentFlavor, dataDir } from '../../services/flavor';
import { RUNNER_LOG, readEnvFile } from '../../services/profile';
import { onPath } from '../agent/enroll';
import { ListenStatus, readListenStatus, updateListenStatus } from '../agent/listenStatus';
import { KEY_INVALID_MESSAGE } from '../agent/runner';
import {
  ServiceOs,
  ServiceSpec,
  launchdPlist,
  launchdPlistFile,
  launchdWrapper,
  launchdWrapperFile,
  serviceEnv,
  serviceLogFile,
  serviceNames,
  servicePath,
  systemdUnit,
  systemdUnitFile,
  windowsScript,
  windowsScriptFile,
} from './spec';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface Sys {
  os: ServiceOs;
  uid: number;
  run(cmd: string, args: string[]): RunResult;
}

export const realSys = (): Sys => ({
  os: toServiceOs(process.platform),
  uid: typeof process.getuid === 'function' ? process.getuid() : 0,
  run(cmd, args) {
    const r = spawnSync(cmd, args, { encoding: 'utf-8', timeout: 30_000 });
    return { code: r.status ?? (r.error ? 127 : 1), stdout: r.stdout ?? '', stderr: r.stderr ?? (r.error ? r.error.message : '') };
  },
});

export function toServiceOs(platform: NodeJS.Platform): ServiceOs {
  if (platform === 'darwin' || platform === 'linux' || platform === 'win32') return platform;
  throw new Error(`不支持在 ${platform} 上安装后台服务（支持 macOS、Linux、Windows）`);
}

/** Tools whose directories go on the service PATH. */
export const PATH_TOOLS = ['claude', 'gemini', 'codex', 'git', 'gh'];

/** Absolute path of `cmd` on `pathEnv` (or in `extraDirs`), undefined when absent. */
export function which(cmd: string, pathEnv = process.env.PATH ?? '', extraDirs: string[] = []): string | undefined {
  const dirs = [...pathEnv.split(path.delimiter), ...extraDirs].filter(Boolean);
  for (const dir of dirs) {
    if (onPath(cmd, dir)) {
      const exts = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : [''];
      for (const ext of exts) {
        const p = path.join(dir, cmd + ext);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  return undefined;
}

export interface SpecOptions {
  profile?: string;
  os: ServiceOs;
  home?: string;
  nodePath?: string;
  cliEntry?: string;
  pathEnv?: string;
  lang?: string;
  /** Resolved tool paths; default: PATH_TOOLS looked up on pathEnv and ~/.local/bin. */
  toolPaths?: string[];
}

/** dist/index.js of the running install (this file is dist/commands/service/service.js). */
export const CLI_ENTRY = path.resolve(__dirname, '..', '..', 'index.js');

export function buildSpec(o: SpecOptions): ServiceSpec {
  const home = o.home ?? os.homedir();
  const pathEnv = o.pathEnv ?? process.env.PATH ?? '';
  const nodePath = o.nodePath ?? process.execPath;
  const toolPaths =
    o.toolPaths ??
    (PATH_TOOLS.map((t) => which(t, pathEnv, [path.join(home, '.local', 'bin')])).filter(Boolean) as string[]);
  const env = serviceEnv({
    home,
    pathEnv: servicePath({ os: o.os, nodePath, toolPaths, home, currentPath: pathEnv }),
    profile: o.profile,
    lang: o.lang ?? process.env.LANG,
  });
  return {
    os: o.os,
    profile: o.profile,
    home,
    dataDir: dataDir(currentFlavor, home, o.profile ?? null),
    nodePath,
    cliEntry: o.cliEntry ?? CLI_ENTRY,
    env,
  };
}

export interface PlannedFile {
  path: string;
  content: string;
  mode: number;
}

export interface Plan {
  files: PlannedFile[];
  /** Commands run after writing, in order; a failing one stops the install. `ignoreFailure` = best effort. */
  commands: { cmd: string; args: string[]; ignoreFailure?: boolean }[];
}

export function installPlan(s: ServiceSpec, uid: number): Plan {
  const names = serviceNames(s.profile);
  if (s.os === 'darwin') {
    const plist = launchdPlistFile(s);
    const domain = `gui/${uid}`;
    return {
      files: [
        { path: launchdWrapperFile(s), content: launchdWrapper(s), mode: 0o700 },
        { path: plist, content: launchdPlist(s), mode: 0o644 },
      ],
      commands: [
        { cmd: 'launchctl', args: ['bootout', `${domain}/${names.label}`], ignoreFailure: true },
        { cmd: 'launchctl', args: ['enable', `${domain}/${names.label}`], ignoreFailure: true },
        { cmd: 'launchctl', args: ['bootstrap', domain, plist] },
      ],
    };
  }
  if (s.os === 'linux') {
    return {
      files: [{ path: systemdUnitFile(s), content: systemdUnit(s), mode: 0o644 }],
      commands: [
        { cmd: 'systemctl', args: ['--user', 'daemon-reload'] },
        { cmd: 'systemctl', args: ['--user', 'enable', names.unit] },
        { cmd: 'systemctl', args: ['--user', 'restart', names.unit] },
      ],
    };
  }
  const script = windowsScriptFile(s);
  return {
    files: [{ path: script, content: windowsScript(s), mode: 0o700 }],
    commands: [
      { cmd: 'schtasks', args: ['/Create', '/TN', names.task, '/TR', `"${script}"`, '/SC', 'ONLOGON', '/RL', 'LIMITED', '/F'] },
      { cmd: 'schtasks', args: ['/Run', '/TN', names.task] },
    ],
  };
}

export function uninstallPlan(s: ServiceSpec, uid: number): { remove: string[]; commands: Plan['commands'] } {
  const names = serviceNames(s.profile);
  if (s.os === 'darwin') {
    return {
      remove: [launchdPlistFile(s), launchdWrapperFile(s)],
      commands: [{ cmd: 'launchctl', args: ['bootout', `gui/${uid}/${names.label}`], ignoreFailure: true }],
    };
  }
  if (s.os === 'linux') {
    return {
      remove: [systemdUnitFile(s)],
      commands: [
        { cmd: 'systemctl', args: ['--user', 'disable', '--now', names.unit], ignoreFailure: true },
        // after the file is gone
        { cmd: 'systemctl', args: ['--user', 'daemon-reload'], ignoreFailure: true },
      ],
    };
  }
  return {
    remove: [windowsScriptFile(s)],
    commands: [
      { cmd: 'schtasks', args: ['/End', '/TN', names.task], ignoreFailure: true },
      { cmd: 'schtasks', args: ['/Delete', '/TN', names.task, '/F'], ignoreFailure: true },
    ],
  };
}

const quoteArg = (a: string) => (/^[A-Za-z0-9_./:=@%+-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);
export const describeCommand = (c: { cmd: string; args: string[] }) => [c.cmd, ...c.args].map(quoteArg).join(' ');

function runAll(sys: Sys, commands: Plan['commands']): void {
  for (const c of commands) {
    const r = sys.run(c.cmd, c.args);
    if (r.code !== 0 && !c.ignoreFailure) {
      throw new Error(`${describeCommand(c)} 失败（退出码 ${r.code}）: ${(r.stderr || r.stdout).trim().slice(0, 500)}`);
    }
  }
}

/** `<dir>/config.json` as read-only JSON (`{}` when missing or broken); no ConfigService, so nothing is created. */
export function readConfigFile(dir: string): Record<string, any> {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf-8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

/** Why this profile cannot run as a service yet (no key / no forward), else undefined. */
export function notReady(s: ServiceSpec): string | undefined {
  const cfg = readConfigFile(s.dataDir);
  const hint = s.profile ? `good7ob setup <令牌> --profile ${s.profile}` : 'good7ob setup <令牌>';
  if (!cfg.apiKey) return `${s.dataDir} 里还没有 Key，先运行 ${hint}`;
  const fwd = cfg.agent?.forward ?? {};
  if (!fwd.url && !fwd.command) return `还没有配置转发命令，先运行 ${hint}`;
  return undefined;
}

export interface InstallResult {
  plan: Plan;
  dryRun: boolean;
}

export function install(s: ServiceSpec, sys: Sys, o: { dryRun?: boolean } = {}): InstallResult {
  const plan = installPlan(s, sys.uid);
  if (o.dryRun) return { plan, dryRun: true };
  fs.mkdirSync(s.dataDir, { recursive: true, mode: 0o700 });
  for (const f of plan.files) {
    fs.mkdirSync(path.dirname(f.path), { recursive: true });
    fs.writeFileSync(f.path, f.content, { encoding: 'utf-8', mode: f.mode });
    fs.chmodSync(f.path, f.mode);
  }
  // a reinstall after re-enrolling starts clean: no stale "key rejected" from the old key
  updateListenStatus(s.dataDir, { keyInvalidAt: undefined });
  runAll(sys, plan.commands);
  return { plan, dryRun: false };
}

export function uninstall(s: ServiceSpec, sys: Sys, o: { dryRun?: boolean } = {}): { removed: string[]; commands: Plan['commands'] } {
  const plan = uninstallPlan(s, sys.uid);
  if (o.dryRun) return { removed: plan.remove, commands: plan.commands };
  // stop first (launchd / schtasks need the definition to find the job), reload systemd after removing
  const split = s.os === 'linux' ? 1 : plan.commands.length;
  const first = plan.commands.slice(0, split);
  const rest = plan.commands.slice(split);
  runAll(sys, first);
  const removed: string[] = [];
  for (const f of plan.remove) {
    if (fs.existsSync(f)) {
      fs.rmSync(f, { force: true });
      removed.push(f);
    }
  }
  runAll(sys, rest);
  return { removed, commands: plan.commands };
}

export interface ServiceStatus {
  name: string;
  manager: 'launchd' | 'systemd' | 'schtasks';
  installed: boolean;
  running: boolean;
  pid?: number;
  lastExitCode?: number;
  definition: string;
  profile?: string;
  dataDir: string;
  listen: ListenStatus;
  keyInvalid: boolean;
  logFile: string;
  logTail: string[];
}

/** `launchctl print` lines `state = running`, `pid = 123`, `last exit code = 1`. */
export function parseLaunchctlPrint(text: string): { running: boolean; pid?: number; lastExitCode?: number } {
  const get = (re: RegExp) => text.match(re)?.[1];
  const pid = get(/^\s*pid = (\d+)/m);
  const exit = get(/^\s*last exit code = (-?\d+)/m);
  return {
    running: get(/^\s*state = (\S+)/m) === 'running',
    ...(pid ? { pid: Number(pid) } : {}),
    ...(exit ? { lastExitCode: Number(exit) } : {}),
  };
}

/** `systemctl show -p ActiveState,MainPID,ExecMainStatus` key=value lines. */
export function parseSystemctlShow(text: string): { running: boolean; pid?: number; lastExitCode?: number } {
  const kv = Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((l) => l.split('='))
      .filter((p) => p.length >= 2)
      .map(([k, ...v]) => [k.trim(), v.join('=').trim()])
  );
  const pid = Number(kv.MainPID);
  const exit = kv.ExecMainStatus;
  return {
    running: kv.ActiveState === 'active',
    ...(pid > 0 ? { pid } : {}),
    ...(exit !== undefined && exit !== '' ? { lastExitCode: Number(exit) } : {}),
  };
}

/** `schtasks /Query /FO LIST /V`: "Status: Running", "Last Result: 0". */
export function parseSchtasks(text: string): { running: boolean; lastExitCode?: number } {
  const status = text.match(/^\s*Status:\s*(.+)$/m)?.[1]?.trim();
  const last = text.match(/^\s*Last Result:\s*(-?\d+)/m)?.[1];
  return { running: status === 'Running', ...(last ? { lastExitCode: Number(last) } : {}) };
}

export function tail(file: string, lines: number): string[] {
  try {
    const text = fs.readFileSync(file, 'utf-8');
    return text.split(/\r?\n/).filter((l) => l.length).slice(-lines);
  } catch {
    return [];
  }
}

export function status(s: ServiceSpec, sys: Sys, o: { lines?: number } = {}): ServiceStatus {
  const names = serviceNames(s.profile);
  let manager: ServiceStatus['manager'];
  let definition: string;
  let state: { running: boolean; pid?: number; lastExitCode?: number } = { running: false };
  if (s.os === 'darwin') {
    manager = 'launchd';
    definition = launchdPlistFile(s);
    const r = sys.run('launchctl', ['print', `gui/${sys.uid}/${names.label}`]);
    if (r.code === 0) state = parseLaunchctlPrint(r.stdout);
  } else if (s.os === 'linux') {
    manager = 'systemd';
    definition = systemdUnitFile(s);
    const r = sys.run('systemctl', ['--user', 'show', names.unit, '-p', 'ActiveState,MainPID,ExecMainStatus']);
    if (r.code === 0) state = parseSystemctlShow(r.stdout);
  } else {
    manager = 'schtasks';
    definition = windowsScriptFile(s);
    const r = sys.run('schtasks', ['/Query', '/TN', names.task, '/FO', 'LIST', '/V']);
    if (r.code === 0) state = parseSchtasks(r.stdout);
  }
  const listen = readListenStatus(s.dataDir);
  const serviceLog = serviceLogFile(s);
  const logFile = fs.existsSync(serviceLog) ? serviceLog : path.join(s.dataDir, RUNNER_LOG);
  const logTail = tail(logFile, o.lines ?? 10);
  return {
    name: s.os === 'darwin' ? names.label : s.os === 'linux' ? names.unit : names.task,
    manager,
    installed: fs.existsSync(definition),
    ...state,
    definition,
    profile: s.profile,
    dataDir: s.dataDir,
    listen,
    keyInvalid: !!listen.keyInvalidAt || (state.lastExitCode === 6 && !state.running),
    logFile,
    logTail,
  };
}

/** Stop / uninstall commands printed after install and by setup. */
export function controlHints(s: ServiceSpec, uid: number): { stop: string; start: string; uninstall: string; status: string } {
  const names = serviceNames(s.profile);
  const p = s.profile ? ` --profile ${s.profile}` : '';
  const native =
    s.os === 'darwin'
      ? { stop: `launchctl bootout gui/${uid}/${names.label}`, start: `launchctl bootstrap gui/${uid} ${quoteArg(launchdPlistFile(s))}` }
      : s.os === 'linux'
      ? { stop: `systemctl --user stop ${names.unit}`, start: `systemctl --user start ${names.unit}` }
      : { stop: `schtasks /End /TN ${names.task}`, start: `schtasks /Run /TN ${names.task}` };
  return { ...native, uninstall: `good7ob service uninstall${p}`, status: `good7ob service status${p}` };
}

export function describeStatus(st: ServiceStatus, hints: ReturnType<typeof controlHints>, nowMs = Date.now()): string {
  const lines = [`后台服务 ${st.name}（${st.manager}${st.manager === 'schtasks' ? '，试用' : ''}）`];
  if (!st.installed) lines.push('  状态: 未安装');
  else if (st.running) lines.push(`  状态: 运行中${st.pid ? `（pid ${st.pid}）` : ''}`);
  else lines.push(`  状态: 已安装，未运行${st.lastExitCode !== undefined ? `（上次退出码 ${st.lastExitCode}）` : ''}`);
  lines.push(`  配置档: ${st.profile ?? '（默认）'}（${st.dataDir}）`);
  if (st.listen.lastBeatAt) {
    const ago = Math.max(0, Math.round((nowMs - Date.parse(st.listen.lastBeatAt)) / 1000));
    lines.push(`  最近心跳: ${st.listen.lastBeatAt}（${ago} 秒前）${st.listen.runnerId ? `  Runner #${st.listen.runnerId}` : ''}`);
  } else {
    lines.push('  最近心跳: 还没有');
  }
  if (st.keyInvalid) {
    lines.push(`  ! ${KEY_INVALID_MESSAGE}${st.listen.keyInvalidAt ? `（${st.listen.keyInvalidAt}）` : ''}：在网页上生成新令牌后运行 good7ob setup <新令牌>${st.profile ? ` --profile ${st.profile}` : ''}`);
  }
  if (st.installed) lines.push(`  定义文件: ${st.definition}`);
  lines.push(`  日志: ${st.logFile}`);
  if (st.logTail.length) {
    lines.push('  最近日志:');
    for (const l of st.logTail) lines.push(`    ${l}`);
  }
  if (st.installed) lines.push(`  停用: ${hints.stop}`, `  卸载: ${hints.uninstall}`);
  else lines.push(`  安装: good7ob service install${st.profile ? ` --profile ${st.profile}` : ''}`);
  return lines.join('\n');
}

/** The env the service hands the forward command: its own env plus the profile's env file (as listen does). */
export function serviceRunEnv(s: ServiceSpec): Record<string, string> {
  return { ...s.env, ...(s.profile ? readEnvFile(s.dataDir) : {}) };
}

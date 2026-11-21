import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runCli } from '../../../utils/__tests__/cliHarness';
import { readListenStatus, updateListenStatus } from '../../agent/listenStatus';
import { ServiceCommandDeps, registerServiceCommands } from '../index';
import {
  RunResult,
  Sys,
  buildSpec,
  controlHints,
  describeStatus,
  install,
  installPlan,
  notReady,
  parseLaunchctlPrint,
  parseSchtasks,
  parseSystemctlShow,
  status,
  uninstall,
} from '../service';
import {
  ServiceOs,
  launchdPlist,
  launchdPlistFile,
  launchdWrapper,
  launchdWrapperFile,
  serviceNames,
  servicePath,
  systemdUnit,
  systemdUnitFile,
  windowsScript,
} from '../spec';

// the shared ConfigService (via the harness) must never read the real ~/.good7ob*
vi.mock('os', async () => {
  const actual = (await vi.importActual('os')) as typeof import('os');
  const homedir = () => '/nonexistent-test-home';
  return { ...actual, default: { ...actual, homedir }, homedir };
});

let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-'));
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** Records every call; answers from `answers` (first matching prefix of "cmd args…"), else exit 0. */
function fakeSys(osName: ServiceOs, answers: Record<string, RunResult> = {}): Sys & { calls: string[] } {
  const calls: string[] = [];
  return {
    os: osName,
    uid: 501,
    calls,
    run(cmd, args) {
      const line = [cmd, ...args].join(' ');
      calls.push(line);
      const key = Object.keys(answers).find((k) => line.startsWith(k));
      return key ? answers[key] : { code: 0, stdout: '', stderr: '' };
    },
  };
}

const spec = (osName: ServiceOs, profile: string | undefined = 'org115-emp41') =>
  buildSpec({
    profile,
    os: osName,
    home,
    nodePath: '/opt/node/bin/node',
    cliEntry: '/opt/good7ob/dist/index.js',
    pathEnv: '/usr/bin',
    toolPaths: ['/Users/u/.local/bin/claude', '/usr/bin/git'],
    lang: 'ja_JP.UTF-8',
  });

const writeProfile = (profile: string, cfg: Record<string, unknown>) => {
  const dir = path.join(home, '.good7ob-profiles', profile);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg));
  return dir;
};

describe('service PATH and environment', () => {
  it('puts node, the tool dirs and ~/.local/bin before the system dirs, without duplicates', () => {
    const p = servicePath({ os: 'darwin', nodePath: '/n/bin/node', toolPaths: ['/a/claude', '/usr/bin/git', '/a/gh'], home: '/Users/u' });
    expect(p.split(':')).toEqual(['/n/bin', '/a', '/usr/bin', '/Users/u/.local/bin', '/opt/homebrew/bin', '/usr/local/bin', '/bin', '/usr/sbin', '/sbin']);
  });

  it('keeps the current PATH on Windows after node and the tools', () => {
    const p = servicePath({ os: 'win32', nodePath: 'C:\\node\\node.exe', toolPaths: [], home: 'C:\\Users\\u', currentPath: 'C:\\Windows;c:\\node' });
    expect(p).toBe('C:\\node;C:\\Users\\u\\.local\\bin;C:\\Windows');
  });

  it('runs with the real HOME, the profile and a fixed PATH — no secrets', () => {
    const s = spec('darwin');
    expect(s.env).toEqual({
      HOME: home,
      PATH: `/opt/node/bin:/Users/u/.local/bin:/usr/bin:${home}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/bin:/usr/sbin:/sbin`,
      GOOD7OB_PROFILE: 'org115-emp41',
      LANG: 'ja_JP.UTF-8',
    });
    expect(s.dataDir).toBe(path.join(home, '.good7ob-profiles', 'org115-emp41'));
  });
});

describe('launchd (macOS)', () => {
  it('plist: wrapper as program, KeepAlive only after a failed exit, log in the profile', () => {
    const s = spec('darwin');
    const plist = launchdPlist(s);
    expect(launchdPlistFile(s)).toBe(path.join(home, 'Library/LaunchAgents/com.good7ob.runner.org115-emp41.plist'));
    expect(plist).toContain('<string>com.good7ob.runner.org115-emp41</string>');
    expect(plist).toContain(`<string>${launchdWrapperFile(s)}</string>`);
    expect(plist).toMatch(/<key>KeepAlive<\/key>\s*<dict>\s*<key>SuccessfulExit<\/key>\s*<false\/>/);
    expect(plist).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
    expect(plist).toContain(`<string>${path.join(s.dataDir, 'service.log')}</string>`);
    expect(plist).toContain('<key>GOOD7OB_PROFILE</key>');
  });

  it('plist escapes XML in paths', () => {
    const s = { ...spec('darwin'), env: { HOME: '/a&b<c>' } };
    expect(launchdPlist(s)).toContain('<string>/a&amp;b&lt;c&gt;</string>');
  });

  it('wrapper turns exit 6 into 0 (no restart) and forwards SIGTERM to listen', () => {
    const w = launchdWrapper(spec('darwin'));
    expect(w).toContain(`'/opt/node/bin/node' '/opt/good7ob/dist/index.js' '--profile' 'org115-emp41' 'agent' 'listen' &`);
    expect(w).toContain(`trap 'kill -TERM "$pid" 2>/dev/null' TERM INT HUP`);
    expect(w).toMatch(/if \[ "\$code" -eq 6 \]; then[\s\S]*exit 0\nfi\nexit "\$code"/);
  });

  it('install writes the wrapper (700) and plist, reloads the job; uninstall boots it out and removes both', () => {
    const s = spec('darwin');
    updateListenStatus(s.dataDir, { keyInvalidAt: '2026-11-01T00:00:00Z', lastBeatAt: '2026-11-01T00:00:00Z' });
    const sys = fakeSys('darwin');
    install(s, sys);
    expect(fs.statSync(launchdWrapperFile(s)).mode & 0o777).toBe(0o700);
    expect(fs.readFileSync(launchdPlistFile(s), 'utf-8')).toBe(launchdPlist(s));
    expect(sys.calls).toEqual([
      'launchctl bootout gui/501/com.good7ob.runner.org115-emp41',
      'launchctl enable gui/501/com.good7ob.runner.org115-emp41',
      `launchctl bootstrap gui/501 ${launchdPlistFile(s)}`,
    ]);
    // a reinstall clears the old "key rejected" mark
    expect(readListenStatus(s.dataDir)).toEqual({ lastBeatAt: '2026-11-01T00:00:00Z' });

    const sys2 = fakeSys('darwin');
    const r = uninstall(s, sys2);
    expect(sys2.calls).toEqual(['launchctl bootout gui/501/com.good7ob.runner.org115-emp41']);
    expect(r.removed).toEqual([launchdPlistFile(s), launchdWrapperFile(s)]);
    expect(fs.existsSync(launchdPlistFile(s))).toBe(false);
  });

  it('a failing bootstrap fails the install; bootout of a job that is not loaded does not', () => {
    const sys = fakeSys('darwin', {
      'launchctl bootout': { code: 113, stdout: '', stderr: 'Could not find service' },
      'launchctl bootstrap': { code: 5, stdout: '', stderr: 'Bootstrap failed: 5: Input/output error' },
    });
    expect(() => install(spec('darwin'), sys)).toThrow(/launchctl bootstrap .* 失败（退出码 5）: Bootstrap failed/);
  });

  it('dry run writes and runs nothing', () => {
    const s = spec('darwin');
    const sys = fakeSys('darwin');
    const r = install(s, sys, { dryRun: true });
    expect(r.plan.files.map((f) => f.path)).toEqual([launchdWrapperFile(s), launchdPlistFile(s)]);
    expect(sys.calls).toEqual([]);
    expect(fs.existsSync(launchdPlistFile(s))).toBe(false);
  });
});

describe('systemd (Linux)', () => {
  it('unit: restart on failure except exit 6, environment, listen command', () => {
    const s = spec('linux');
    const unit = systemdUnit(s);
    expect(systemdUnitFile(s)).toBe(path.join(home, '.config/systemd/user/good7ob-runner-org115-emp41.service'));
    expect(unit).toContain('Restart=on-failure');
    expect(unit).toContain('RestartPreventExitStatus=6');
    expect(unit).toContain('KillMode=process');
    expect(unit).toContain(`Environment="HOME=${home}"`);
    expect(unit).toContain('Environment="GOOD7OB_PROFILE=org115-emp41"');
    expect(unit).toContain('ExecStart="/opt/node/bin/node" "/opt/good7ob/dist/index.js" "--profile" "org115-emp41" "agent" "listen"');
    expect(unit).toContain(`StandardOutput=append:${path.join(s.dataDir, 'service.log')}`);
    expect(unit).toContain('WantedBy=default.target');
  });

  it('escapes % and quotes in systemd words', () => {
    const s = { ...spec('linux'), env: { X: 'a%b"c' } };
    expect(systemdUnit(s)).toContain('Environment="X=a%%b\\"c"');
  });

  it('install reloads, enables and restarts the unit; uninstall disables, removes, reloads', () => {
    const s = spec('linux');
    const sys = fakeSys('linux');
    install(s, sys);
    expect(fs.existsSync(systemdUnitFile(s))).toBe(true);
    expect(sys.calls).toEqual([
      'systemctl --user daemon-reload',
      'systemctl --user enable good7ob-runner-org115-emp41.service',
      'systemctl --user restart good7ob-runner-org115-emp41.service',
    ]);
    const sys2 = fakeSys('linux');
    uninstall(s, sys2);
    expect(sys2.calls).toEqual(['systemctl --user disable --now good7ob-runner-org115-emp41.service', 'systemctl --user daemon-reload']);
    expect(fs.existsSync(systemdUnitFile(s))).toBe(false);
  });
});

describe('Windows scheduled task (trial)', () => {
  it('script loops on failure, stops on 0 and 6; task runs at logon', () => {
    const s = spec('win32');
    const script = windowsScript(s);
    expect(script).toContain('set "GOOD7OB_PROFILE=org115-emp41"');
    expect(script).toContain('if "%code%"=="6" goto keyinvalid');
    expect(script).toContain('if "%code%"=="0" goto end');
    expect(script).toContain('timeout /t 30 /nobreak >nul');
    expect(script.split('\r\n').length).toBeGreaterThan(5);
    const plan = installPlan(s, 0);
    expect(plan.commands[0].args).toEqual(expect.arrayContaining(['/Create', '/TN', 'good7ob-runner-org115-emp41', '/SC', 'ONLOGON', '/F']));
    expect(plan.commands[1].args).toEqual(['/Run', '/TN', 'good7ob-runner-org115-emp41']);
  });
});

describe('status', () => {
  it('parses launchctl print / systemctl show / schtasks', () => {
    expect(parseLaunchctlPrint('gui/501/x = {\n\tstate = running\n\tpid = 4242\n\tlast exit code = 0\n')).toEqual({ running: true, pid: 4242, lastExitCode: 0 });
    expect(parseLaunchctlPrint('\tstate = not running\n\tlast exit code = 1\n')).toEqual({ running: false, lastExitCode: 1 });
    expect(parseSystemctlShow('ActiveState=active\nMainPID=99\nExecMainStatus=0\n')).toEqual({ running: true, pid: 99, lastExitCode: 0 });
    expect(parseSystemctlShow('ActiveState=failed\nMainPID=0\nExecMainStatus=6\n')).toEqual({ running: false, lastExitCode: 6 });
    expect(parseSchtasks('TaskName: \\good7ob-runner-x\nStatus: Running\nLast Result: 0\n')).toEqual({ running: true, lastExitCode: 0 });
  });

  it('shows running state, last heartbeat and the log tail', () => {
    const s = spec('darwin');
    install(s, fakeSys('darwin'));
    fs.writeFileSync(path.join(s.dataDir, 'service.log'), Array.from({ length: 15 }, (_, i) => `line ${i + 1}`).join('\n'));
    updateListenStatus(s.dataDir, { lastBeatAt: '2026-11-22T00:00:00.000Z', runnerId: 7 });
    const sys = fakeSys('darwin', { 'launchctl print': { code: 0, stdout: 'state = running\npid = 12\n', stderr: '' } });
    const st = status(s, sys, { lines: 3 });
    expect(st).toMatchObject({ installed: true, running: true, pid: 12, keyInvalid: false, logTail: ['line 13', 'line 14', 'line 15'] });
    const text = describeStatus(st, controlHints(s, 501), Date.parse('2026-11-22T00:00:30.000Z'));
    expect(text).toContain('状态: 运行中（pid 12）');
    expect(text).toContain('最近心跳: 2026-11-22T00:00:00.000Z（30 秒前）  Runner #7');
    expect(text).toContain('停用: launchctl bootout gui/501/com.good7ob.runner.org115-emp41');
    expect(text).toContain('卸载: good7ob service uninstall --profile org115-emp41');
  });

  it('says the key is invalid from listen-status or a systemd exit 6', () => {
    const s = spec('linux');
    install(s, fakeSys('linux'));
    updateListenStatus(s.dataDir, { keyInvalidAt: '2026-11-22T01:00:00Z' });
    const st = status(s, fakeSys('linux', { 'systemctl --user show': { code: 0, stdout: 'ActiveState=failed\nMainPID=0\nExecMainStatus=6\n', stderr: '' } }));
    expect(st).toMatchObject({ installed: true, running: false, lastExitCode: 6, keyInvalid: true });
    expect(describeStatus(st, controlHints(s, 0))).toContain('这台设备的 Key 已失效，请重新接入（2026-11-22T01:00:00Z）');

    updateListenStatus(s.dataDir, { keyInvalidAt: undefined });
    const st2 = status(s, fakeSys('linux', { 'systemctl --user show': { code: 0, stdout: 'ActiveState=inactive\nExecMainStatus=6\n', stderr: '' } }));
    expect(st2.keyInvalid).toBe(true);
  });

  it('not installed', () => {
    const st = status(spec('darwin'), fakeSys('darwin', { 'launchctl print': { code: 113, stdout: '', stderr: 'not found' } }));
    expect(st).toMatchObject({ installed: false, running: false });
    expect(describeStatus(st, controlHints(spec('darwin'), 501))).toContain('状态: 未安装');
  });
});

describe('notReady', () => {
  it('needs a key and a forward', () => {
    expect(notReady(spec('darwin'))).toMatch(/还没有 Key/);
    writeProfile('org115-emp41', { apiKey: 'k' });
    expect(notReady(spec('darwin'))).toMatch(/还没有配置转发命令/);
    writeProfile('org115-emp41', { apiKey: 'k', agent: { forward: { command: 'x {taskId}' } } });
    expect(notReady(spec('darwin'))).toBeUndefined();
  });
});

describe('good7ob service (commands)', () => {
  const deps = (sys: Sys): ServiceCommandDeps => ({
    sys: () => sys,
    spec: (profile, s) =>
      buildSpec({ profile, os: s.os, home, nodePath: '/n/node', cliEntry: '/c/index.js', pathEnv: '', toolPaths: [] }),
  });

  it('install --dry-run prints the files and commands, touches nothing, warns about the missing key', async () => {
    const sys = fakeSys('darwin');
    const r = await runCli((p) => registerServiceCommands(p, deps(sys)), ['service', 'install', '--profile', 'p1', '--dry-run']);
    expect(r.exitCode).toBeUndefined();
    expect(r.stderr).toContain('还没有 Key');
    expect(r.stdout).toContain('--dry-run');
    expect(r.stdout).toContain('<key>KeepAlive</key>');
    expect(r.stdout).toContain(`launchctl bootstrap gui/501 ${path.join(home, 'Library/LaunchAgents/com.good7ob.runner.p1.plist')}`);
    expect(sys.calls).toEqual([]);
  });

  it('install refuses a profile without a key', async () => {
    const sys = fakeSys('linux');
    const r = await runCli((p) => registerServiceCommands(p, deps(sys)), ['service', 'install', '--profile', 'p1']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('安装后台服务失败');
    expect(sys.calls).toEqual([]);
  });

  it('install of a ready profile prints status / stop / uninstall commands', async () => {
    writeProfile('p1', { apiKey: 'k', agent: { forward: { command: 'x {taskId}' } } });
    const sys = fakeSys('linux');
    const r = await runCli((p) => registerServiceCommands(p, deps(sys)), ['service', 'install', '--profile', 'p1']);
    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toContain('✓ 已安装后台服务（systemd）');
    expect(r.stdout).toContain('停用: systemctl --user stop good7ob-runner-p1.service');
    expect(r.stdout).toContain('卸载: good7ob service uninstall --profile p1');
    expect(r.stdout).toContain('loginctl enable-linger');
  });

  it('status --json', async () => {
    const sys = fakeSys('darwin', { 'launchctl print': { code: 113, stdout: '', stderr: '' } });
    const r = await runCli((p) => registerServiceCommands(p, deps(sys)), ['service', 'status', '--profile', 'p1', '--json']);
    expect(JSON.parse(r.stdout)).toMatchObject({ name: serviceNames('p1').label, installed: false, manager: 'launchd' });
  });
});

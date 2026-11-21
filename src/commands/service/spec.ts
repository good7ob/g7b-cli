/**
 * Background service definitions for `agent listen` (g7b #3633, design B4 / 7.7-4 / 7.7-5). Pure builders only:
 * the files `good7ob service install` writes and the environment the service runs with.
 *
 *   macOS   ~/Library/LaunchAgents/com.good7ob.runner.<profile>.plist → <data dir>/service/run.sh → agent listen
 *           KeepAlive = { SuccessfulExit: false }: restarted after a crash / non-zero exit. The wrapper turns exit 6
 *           (key rejected) into 0, so launchd stops restarting a machine whose key is gone.
 *   Linux   ~/.config/systemd/user/good7ob-runner-<profile>.service, Restart=on-failure, RestartPreventExitStatus=6.
 *   Windows (trial) <data dir>\service\run.cmd, started at logon by a scheduled task; the script itself restarts
 *           listen after a failure and stops on exit 0 / 6.
 *
 * The service gets a fixed PATH (node, the AI tools, git / gh, the usual system dirs) and the real HOME, never the
 * login shell's environment. Secrets stay out of these files: `agent listen` reads the profile's env file itself.
 */

import * as path from 'path';

export type ServiceOs = 'darwin' | 'linux' | 'win32';

export const SERVICE_DIR = 'service';
export const SERVICE_LOG = 'service.log';
/** listen's exit code for a rejected key (agent/index.ts EXIT_KEY_INVALID). */
export const KEY_INVALID_EXIT = 6;
export const RESTART_DELAY_SECONDS = 30;

export interface ServiceSpec {
  os: ServiceOs;
  /** Profile name; undefined = the install's own data dir. */
  profile?: string;
  home: string;
  /** The data dir listen uses (profile dir or ~/.good7ob). */
  dataDir: string;
  nodePath: string;
  /** dist/index.js of this install. */
  cliEntry: string;
  /** Environment of the service process (HOME, PATH, GOOD7OB_PROFILE, LANG). */
  env: Record<string, string>;
}

export interface ServiceNames {
  /** launchd label / systemd unit base / scheduled task name. */
  label: string;
  unit: string;
  task: string;
}

export function serviceNames(profile?: string): ServiceNames {
  const suffix = profile ?? 'default';
  return { label: `com.good7ob.runner.${suffix}`, unit: `good7ob-runner-${suffix}.service`, task: `good7ob-runner-${suffix}` };
}

const DEFAULT_DIRS: Record<ServiceOs, string[]> = {
  darwin: ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'],
  linux: ['/usr/local/bin', '/usr/bin', '/bin', '/usr/local/sbin', '/usr/sbin', '/sbin'],
  win32: [],
};

/**
 * PATH for the service: node's dir, the dirs of the tools found now (claude / gemini / codex / git / gh), the Claude
 * Code installer's ~/.local/bin, then the system dirs. On Windows the current PATH is kept after those (no stable
 * system list to fall back on). Duplicates and empty entries dropped, order kept.
 */
export function servicePath(o: { os: ServiceOs; nodePath: string; toolPaths: string[]; home: string; currentPath?: string }): string {
  const p = o.os === 'win32' ? path.win32 : path.posix;
  const dirs = [
    p.dirname(o.nodePath),
    ...o.toolPaths.map((t) => p.dirname(t)),
    p.join(o.home, '.local', 'bin'),
    ...DEFAULT_DIRS[o.os],
    ...(o.os === 'win32' ? (o.currentPath ?? '').split(';') : []),
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of dirs) {
    const key = o.os === 'win32' ? d.toLowerCase() : d;
    if (!d || seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out.join(o.os === 'win32' ? ';' : ':');
}

export function serviceEnv(o: { home: string; pathEnv: string; profile?: string; lang?: string }): Record<string, string> {
  return {
    HOME: o.home,
    PATH: o.pathEnv,
    ...(o.profile ? { GOOD7OB_PROFILE: o.profile } : {}),
    LANG: o.lang && o.lang.trim() ? o.lang : 'en_US.UTF-8',
  };
}

/** `node <cli> [--profile p] agent listen`. */
export function listenArgv(s: ServiceSpec): string[] {
  return [s.nodePath, s.cliEntry, ...(s.profile ? ['--profile', s.profile] : []), 'agent', 'listen'];
}

export function serviceLogFile(s: ServiceSpec): string {
  return (s.os === 'win32' ? path.win32 : path.posix).join(s.dataDir, SERVICE_LOG);
}

const shQuote = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;
const xml = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------- macOS

export function launchdWrapperFile(s: ServiceSpec): string {
  return path.posix.join(s.dataDir, SERVICE_DIR, 'run.sh');
}

export function launchdPlistFile(s: ServiceSpec): string {
  return path.posix.join(s.home, 'Library', 'LaunchAgents', `${serviceNames(s.profile).label}.plist`);
}

/**
 * Runs listen in the background and forwards SIGTERM to it (launchctl bootout / logout), so listen exits cleanly
 * and frees its leases. Exit 6 becomes 0: with KeepAlive.SuccessfulExit=false launchd then leaves it stopped.
 */
export function launchdWrapper(s: ServiceSpec): string {
  return [
    '#!/bin/sh',
    '# Generated by `good7ob service install`; rerun it instead of editing this file.',
    `${listenArgv(s).map(shQuote).join(' ')} &`,
    'pid=$!',
    `trap 'kill -TERM "$pid" 2>/dev/null' TERM INT HUP`,
    'wait "$pid"',
    'code=$?',
    // a trapped signal interrupts `wait` (code > 128) while listen is still finishing: wait for its own exit code
    'while [ "$code" -gt 128 ] && kill -0 "$pid" 2>/dev/null; do wait "$pid"; code=$?; done',
    `if [ "$code" -eq ${KEY_INVALID_EXIT} ]; then`,
    `  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] 这台设备的 Key 已失效，请重新接入；服务不再自动重启" >&2`,
    '  exit 0',
    'fi',
    'exit "$code"',
    '',
  ].join('\n');
}

export function launchdPlist(s: ServiceSpec): string {
  const log = serviceLogFile(s);
  const env = Object.entries(s.env)
    .map(([k, v]) => `      <key>${xml(k)}</key>\n      <string>${xml(v)}</string>`)
    .join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '  <dict>',
    '    <key>Label</key>',
    `    <string>${xml(serviceNames(s.profile).label)}</string>`,
    '    <key>ProgramArguments</key>',
    '    <array>',
    '      <string>/bin/sh</string>',
    `      <string>${xml(launchdWrapperFile(s))}</string>`,
    '    </array>',
    '    <key>EnvironmentVariables</key>',
    '    <dict>',
    env,
    '    </dict>',
    '    <key>WorkingDirectory</key>',
    `    <string>${xml(s.dataDir)}</string>`,
    '    <key>RunAtLoad</key>',
    '    <true/>',
    '    <key>KeepAlive</key>',
    '    <dict>',
    '      <key>SuccessfulExit</key>',
    '      <false/>',
    '    </dict>',
    '    <key>ThrottleInterval</key>',
    `    <integer>${RESTART_DELAY_SECONDS}</integer>`,
    '    <key>StandardOutPath</key>',
    `    <string>${xml(log)}</string>`,
    '    <key>StandardErrorPath</key>',
    `    <string>${xml(log)}</string>`,
    '  </dict>',
    '</plist>',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------- Linux

export function systemdUnitFile(s: ServiceSpec): string {
  return path.posix.join(s.home, '.config', 'systemd', 'user', serviceNames(s.profile).unit);
}

/** One systemd word: double-quoted, `\` and `"` escaped, `%` doubled (specifier). */
const sdQuote = (v: string) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%')}"`;

/**
 * KillMode=process: stopping / restarting the service ends listen only, a task agent it started keeps running
 * (the same "current task is not returned" rule as Ctrl-C on listen).
 */
export function systemdUnit(s: ServiceSpec): string {
  const log = serviceLogFile(s);
  return [
    '# Generated by `good7ob service install`; rerun it instead of editing this file.',
    '[Unit]',
    `Description=good7ob runner${s.profile ? ` (profile ${s.profile})` : ''}`,
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    `WorkingDirectory=${sdQuote(s.dataDir)}`,
    ...Object.entries(s.env).map(([k, v]) => `Environment=${sdQuote(`${k}=${v}`)}`),
    `ExecStart=${listenArgv(s).map(sdQuote).join(' ')}`,
    'Restart=on-failure',
    `RestartSec=${RESTART_DELAY_SECONDS}`,
    `RestartPreventExitStatus=${KEY_INVALID_EXIT}`,
    'KillMode=process',
    `StandardOutput=append:${log}`,
    `StandardError=append:${log}`,
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------- Windows (trial)

export function windowsScriptFile(s: ServiceSpec): string {
  return path.win32.join(s.dataDir, SERVICE_DIR, 'run.cmd');
}

const cmdValue = (v: string) => v.replace(/%/g, '%%').replace(/"/g, '');

/** Restarts listen after a failure (30 s apart); stops on a clean exit or a rejected key (exit 6). */
export function windowsScript(s: ServiceSpec): string {
  const log = serviceLogFile(s);
  const argv = listenArgv(s)
    .map((a, i) => (i < 2 ? `"${cmdValue(a)}"` : cmdValue(a)))
    .join(' ');
  return [
    '@echo off',
    'rem Generated by `good7ob service install` (trial); rerun it instead of editing this file.',
    ...Object.entries(s.env).map(([k, v]) => `set "${k}=${cmdValue(v)}"`),
    `cd /d "${cmdValue(s.dataDir)}"`,
    ':loop',
    `${argv} >> "${cmdValue(log)}" 2>&1`,
    'set code=%ERRORLEVEL%',
    `if "%code%"=="${KEY_INVALID_EXIT}" goto keyinvalid`,
    'if "%code%"=="0" goto end',
    `timeout /t ${RESTART_DELAY_SECONDS} /nobreak >nul`,
    'goto loop',
    ':keyinvalid',
    `echo Key rejected: re-enroll this machine (good7ob setup ^<token^>). >> "${cmdValue(log)}"`,
    ':end',
    '',
  ].join('\r\n');
}

/**
 * `good7ob service install | uninstall | status [--profile <name>]` (g7b #3633, design B4): run `agent listen` of a
 * profile as a background service that starts at login and comes back after a crash, but stays down once the key
 * is rejected (exit 6, design 7.7-5). See spec.ts for the per-OS definitions.
 */

import { Command } from 'commander';
import { activeProfile, normalizeProfile } from '../../services/profile';
import {
  ServiceStatus,
  Sys,
  buildSpec,
  controlHints,
  describeCommand,
  describeStatus,
  install,
  notReady,
  realSys,
  status,
  uninstall,
} from './service';
import { ServiceSpec } from './spec';

const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

function fail(prefix: string, e: unknown): never {
  console.error(`✗ ${prefix}: ${msgOf(e)}`);
  process.exit(1);
}

/** `--profile` of the subcommand, else the global one / GOOD7OB_PROFILE, else none (the install's own data dir). */
function profileOf(flag: string | undefined): string | undefined {
  return flag !== undefined ? normalizeProfile(flag) : activeProfile();
}

export interface ServiceCommandDeps {
  sys: () => Sys;
  spec: (profile: string | undefined, sys: Sys) => ServiceSpec;
}

export const defaultServiceDeps: ServiceCommandDeps = {
  sys: realSys,
  spec: (profile, sys) => buildSpec({ profile, os: sys.os }),
};

export function describeInstall(spec: ServiceSpec, sys: Sys, r: ReturnType<typeof install>): string {
  const hints = controlHints(spec, sys.uid);
  const lines: string[] = [];
  if (r.dryRun) {
    lines.push('（--dry-run：只显示将要写入的文件和执行的命令，不做任何改动）');
    for (const f of r.plan.files) lines.push('', `# ${f.path}（权限 ${f.mode.toString(8)}）`, f.content.trimEnd());
    lines.push('', '# 将执行:');
    for (const c of r.plan.commands) lines.push(`  ${describeCommand(c)}`);
    return lines.join('\n');
  }
  lines.push(`✓ 已安装后台服务（${spec.os === 'win32' ? 'Windows 计划任务，试用' : spec.os === 'darwin' ? 'launchd' : 'systemd'}）`);
  for (const f of r.plan.files) lines.push(`  ${f.path}`);
  if (spec.os === 'linux') lines.push('  提示: 要在未登录时也保持运行，执行一次 loginctl enable-linger $USER');
  lines.push(`  状态: ${hints.status}`, `  停用: ${hints.stop}`, `  卸载: ${hints.uninstall}`);
  return lines.join('\n');
}

export function registerServiceCommands(program: Command, deps: ServiceCommandDeps = defaultServiceDeps) {
  const service = program
    .command('service')
    .description('Run `agent listen` of a profile as a background service (launchd / systemd user unit / Windows scheduled task, trial)');

  service
    .command('install')
    .description('Write and start the background service; restarts after a crash, stays stopped once the key is rejected (exit 6)')
    .option('--profile <name>', 'Profile to run (default: the global --profile / GOOD7OB_PROFILE, else the default data dir)')
    .option('--dry-run', 'Print the files and commands without writing or running anything')
    .action((opts) => {
      try {
        const profile = profileOf(opts.profile);
        const sys = deps.sys();
        const spec = deps.spec(profile, sys);
        const missing = notReady(spec);
        if (missing && !opts.dryRun) throw new Error(missing);
        if (missing) console.error(`! ${missing}`);
        console.log(describeInstall(spec, sys, install(spec, sys, { dryRun: !!opts.dryRun })));
      } catch (e) {
        fail('安装后台服务失败', e);
      }
    });

  service
    .command('uninstall')
    .description('Stop and remove the background service (the profile and its key stay)')
    .option('--profile <name>', 'Profile whose service to remove (default: the global --profile / GOOD7OB_PROFILE)')
    .option('--dry-run', 'Print what would be removed and run')
    .action((opts) => {
      try {
        const profile = profileOf(opts.profile);
        const sys = deps.sys();
        const spec = deps.spec(profile, sys);
        const r = uninstall(spec, sys, { dryRun: !!opts.dryRun });
        if (opts.dryRun) {
          console.log(['（--dry-run）将删除:', ...r.removed.map((f) => `  ${f}`), '将执行:', ...r.commands.map((c) => `  ${describeCommand(c)}`)].join('\n'));
          return;
        }
        console.log(r.removed.length ? ['✓ 已卸载后台服务', ...r.removed.map((f) => `  已删除 ${f}`)].join('\n') : '✓ 后台服务未安装（已确保停止）');
        console.log(`  配置档和 Key 保留；重新安装: good7ob service install${profile ? ` --profile ${profile}` : ''}`);
      } catch (e) {
        fail('卸载后台服务失败', e);
      }
    });

  service
    .command('status')
    .description('Whether the service runs, the last heartbeat, a rejected key, and the latest log lines')
    .option('--profile <name>', 'Profile to inspect (default: the global --profile / GOOD7OB_PROFILE)')
    .option('--lines <n>', 'Log lines to show (default 10)', '10')
    .option('--json', 'Output as JSON')
    .action((opts) => {
      let st: ServiceStatus;
      let spec: ServiceSpec;
      let sys: Sys;
      try {
        const profile = profileOf(opts.profile);
        sys = deps.sys();
        spec = deps.spec(profile, sys);
        const lines = Math.max(0, Math.min(200, Number.parseInt(opts.lines, 10) || 10));
        st = status(spec, sys, { lines });
      } catch (e) {
        return fail('查询后台服务失败', e);
      }
      console.log(opts.json ? JSON.stringify(st, null, 2) : describeStatus(st, controlHints(spec, sys.uid)));
    });
}

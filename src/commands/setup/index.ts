/**
 * `good7ob setup <token> [--api-url] [--profile] [--yes] [--agent claude|gemini|codex]` (g7b #3633). The steps are
 * in wizard.ts; this file wires them to the real terminal, processes and service manager.
 */

import { spawn } from 'child_process';
import { Command } from 'commander';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';
import * as tty from 'tty';
import { Readable, Writable } from 'stream';
import { enroll } from '../agent/enroll';
import { buildSpec, install, realSys, which } from '../service/service';
import { ExecOptions, ExecResult, SetupDeps, SetupError, SetupIo, parseAgent, runSetup } from './wizard';

const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function realExec(cmd: string, args: string[], o: ExecOptions = {}): Promise<ExecResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let done = false;
    const finish = (r: ExecResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(r);
    };
    const child = spawn(cmd, args, {
      env: o.env ?? process.env,
      cwd: o.cwd,
      // the test prompt must not wait for stdin (claude -p reads a piped stdin as extra input)
      stdio: o.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd),
    });
    child.stdout?.on('data', (b) => (stdout += b.toString()));
    child.stderr?.on('data', (b) => (stderr += b.toString()));
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish({ code: 124, stdout, stderr: `${stderr}\n超时（${Math.round((o.timeoutMs ?? 0) / 1000)} 秒）` });
    }, o.timeoutMs ?? 10 * 60_000);
    child.once('error', (e) => finish({ code: 127, stdout, stderr: e.message }));
    child.once('close', (code) => finish({ code: code ?? 1, stdout, stderr }));
  });
}

/**
 * The terminal: stdin when it is a TTY, else /dev/tty (an install script run as `curl … | sh` has the script on
 * stdin but a person at the keyboard). No terminal at all = not interactive.
 */
export function terminalIo(): SetupIo {
  let input: Readable | undefined;
  let output: Writable = process.stdout;
  if (process.stdin.isTTY) input = process.stdin;
  else if (process.platform !== 'win32') {
    try {
      input = new tty.ReadStream(fs.openSync('/dev/tty', 'r'));
      output = new tty.WriteStream(fs.openSync('/dev/tty', 'w'));
    } catch {
      input = undefined;
    }
  }
  const question = (q: string, secret: boolean) =>
    new Promise<string | null>((resolve) => {
      if (!input) return resolve(null);
      let muted = false;
      const rl = readline.createInterface({ input, output, terminal: true });
      const rlw = rl as unknown as { _writeToOutput: (s: string) => void };
      const orig = rlw._writeToOutput.bind(rl);
      rlw._writeToOutput = (s: string) => {
        if (!muted) orig(s);
      };
      let answered = false;
      rl.once('close', () => {
        if (!answered) resolve(null);
      });
      rl.question(q, (a) => {
        answered = true;
        if (secret) output.write('\n');
        rl.close();
        resolve(a);
      });
      muted = secret;
    });
  return {
    interactive: !!input,
    ask: (q) => question(q, false),
    askSecret: (q) => question(q, true),
    log: (m) => console.log(m),
    warn: (m) => console.error(m),
    close: () => {
      // an opened /dev/tty would keep the process alive
      if (input && input !== process.stdin) input.destroy();
      if (output !== process.stdout) output.destroy();
    },
  };
}

export function realSetupDeps(): SetupDeps {
  const sys = realSys();
  return {
    io: terminalIo(),
    exec: realExec,
    which,
    enroll,
    sys,
    buildSpec,
    installService: (spec, s) => install(spec, s),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
    env: process.env,
    home: os.homedir(),
    nodeDir: path.dirname(process.execPath),
  };
}

export function registerSetupCommands(program: Command, deps: () => SetupDeps = realSetupDeps) {
  program
    .command('setup <token>')
    .description('Set this machine up as a runner from a one-time enrollment token: AI tool, login check, enroll, forward command, MCP, background service')
    .option('--api-url <url>', 'API address to enroll at (the install script passes its site\'s)')
    .option('--profile <name>', 'Profile to write (default: the name in the enrollment answer, e.g. org115-emp41)')
    .option('--yes', 'Take every default without asking (installs Claude Code if no AI tool is found; fails instead of waiting for a login)')
    .option('--agent <tool>', 'AI tool to use: claude | gemini | codex (default: the first found in that order)')
    .option('--no-mcp', 'Skip adding the good7ob MCP to the AI tool')
    .option('--no-service', 'Configure only; do not install the background service (run `agent listen` yourself)')
    .action(async (token, opts) => {
      const d = deps();
      try {
        await runSetup(
          {
            token,
            apiUrl: opts.apiUrl,
            profile: opts.profile,
            yes: !!opts.yes,
            agent: opts.agent !== undefined ? parseAgent(opts.agent) : undefined,
            mcp: opts.mcp,
            service: opts.service,
          },
          d
        );
      } catch (e) {
        d.io.close?.();
        console.error(e instanceof SetupError ? `✗ ${e.message}` : `✗ setup 失败: ${msgOf(e)}`);
        process.exit(1);
      }
      d.io.close?.();
    });
}

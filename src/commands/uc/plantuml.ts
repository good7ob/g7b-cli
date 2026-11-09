/**
 * Local PlantUML rendering for `uc push` / `uc render` (rp-ucase-0050 / 0051 / 0053 / 0070).
 *
 * Nothing here talks to a server. The render command is `plantuml` or whatever GOOD7OB_PLANTUML_CMD says
 * (`java -jar plantuml.jar`, `docker run --rm -i plantuml/plantuml`). The SANDBOX security profile is forced:
 *  - the child's environment always carries PLANTUML_SECURITY_PROFILE=SANDBOX, whatever the user's shell has;
 *  - PlantUML reads a JVM system property of that name BEFORE the environment variable (measured on 1.2026.8:
 *    JAVA_TOOL_OPTIONS=-DPLANTUML_SECURITY_PROFILE=LEGACY beats the env var), so option variables that name the
 *    profile are dropped, and a command line that names it is refused;
 *  - for `docker|podman run ...` the variable is passed with `-e` (docker does not forward the host environment),
 *    any `-e`/`--network` the user wrote is stripped, and `--network none` is added.
 * Nothing falls back to a hosted PlantUML service.
 */
import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const PLANTUML_CMD_ENV = 'GOOD7OB_PLANTUML_CMD';
export const SECURITY_ENV = 'PLANTUML_SECURITY_PROFILE';
export const SECURITY_PROFILE = 'SANDBOX';
/**
 * Conservative floor: SANDBOX is documented for 2021+ releases but only 1.2026.8 was measured, so anything older
 * than 1.2022.0 is refused rather than trusted to understand the profile.
 */
export const MIN_VERSION: readonly [number, number, number] = [1, 2022, 0];
const RENDER_TIMEOUT_MS = 120_000;
const PROBE_TIMEOUT_MS = 120_000; // `-version` also runs a Graphviz self-test and can be slow on a busy machine
const PROFILE_RE = /plantuml[._]security[._]profile/i;
const JAVA_OPTION_VARS = ['JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS', 'JDK_JAVA_OPTIONS'];
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const INSTALL_HINT = [
  '安装方法（这些依赖不随 CLI 打包）：',
  '  macOS:         brew install plantuml graphviz openjdk',
  '  Debian/Ubuntu: sudo apt install plantuml graphviz default-jre',
  `  或用容器:      export ${PLANTUML_CMD_ENV}="docker run --rm -i plantuml/plantuml:latest"`,
  `  或指定 jar:    export ${PLANTUML_CMD_ENV}="java -jar /path/to/plantuml.jar"`,
].join('\n');

/** A local setup problem (missing or unsuitable PlantUML): nothing was rendered. */
export class SetupError extends Error {}

export interface RenderProblem { line?: number; message: string }

/** PlantUML rejected the source (or died): `problems` carries its messages with line numbers when it gave them. */
export class RenderError extends Error {
  constructor(message: string, public readonly problems: RenderProblem[] = []) {
    super(message);
  }
}

export interface Rendered { png: Buffer; version: string }

/** Shell-like split: whitespace separates, quotes group, backslash escapes outside single quotes. */
export function splitCommand(raw: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let started = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && i + 1 < raw.length) cur += raw[++i];
      else cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      started = true;
    } else if (c === '\\' && i + 1 < raw.length) {
      cur += raw[++i];
      started = true;
    } else if (/\s/.test(c)) {
      if (started || cur) tokens.push(cur);
      cur = '';
      started = false;
    } else {
      cur += c;
    }
  }
  if (quote) throw new SetupError(`${PLANTUML_CMD_ENV} 里的引号没有闭合`);
  if (started || cur) tokens.push(cur);
  return tokens;
}

/** The environment of the render child: the caller's, with the security profile forced to SANDBOX. */
export function safeEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    if (key.toUpperCase() === SECURITY_ENV) continue;
    if (JAVA_OPTION_VARS.includes(key.toUpperCase()) && value && PROFILE_RE.test(value)) continue;
    env[key] = value;
  }
  env[SECURITY_ENV] = SECURITY_PROFILE;
  return env;
}

const isContainerTool = (token: string) => ['docker', 'podman'].includes(path.basename(token).replace(/\.exe$/i, ''));

/** Drops `-e/--env X` pairs naming the profile and `--network/--net X` pairs; returns the remaining tokens. */
function stripContainerFlags(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '-e' || t === '--env') {
      if (PROFILE_RE.test(tokens[i + 1] ?? '')) i++;
      else out.push(t);
    } else if (/^(--env=|-e.)/.test(t) && PROFILE_RE.test(t)) {
      continue;
    } else if (t === '--network' || t === '--net') {
      i++;
    } else if (/^--(network|net)=/.test(t)) {
      continue;
    } else {
      out.push(t);
    }
  }
  return out;
}

/** The program and arguments to spawn for the user's command, with the security profile pinned (see file header). */
export function buildInvocation(tokens: string[], plantumlArgs: string[]): { file: string; args: string[] } {
  if (!tokens.length) throw new SetupError(`${PLANTUML_CMD_ENV} 是空的`);
  if (isContainerTool(tokens[0])) {
    const run = tokens.indexOf('run', 1);
    if (run < 0) throw new SetupError(`${PLANTUML_CMD_ENV} 用容器时必须是 \`${path.basename(tokens[0])} run ...\` 形式（安全档位要用 -e 传进容器）`);
    const args = [
      ...tokens.slice(1, run + 1), '-i', '--network', 'none', '-e', `${SECURITY_ENV}=${SECURITY_PROFILE}`,
      ...stripContainerFlags(tokens.slice(run + 1)), ...plantumlArgs,
    ];
    return { file: tokens[0], args };
  }
  if (tokens.some((t) => PROFILE_RE.test(t))) {
    throw new SetupError(`${PLANTUML_CMD_ENV} 里不能自行指定 PlantUML 安全档位：CLI 固定使用 ${SECURITY_PROFILE}`);
  }
  return { file: tokens[0], args: [...tokens.slice(1), ...plantumlArgs] };
}

export function parseVersion(output: string): { text: string; parts: [number, number, number] } | null {
  const m = /PlantUML version\s+(\d+)\.(\d+)\.(\d+)/i.exec(output);
  return m ? { text: `${m[1]}.${m[2]}.${m[3]}`, parts: [Number(m[1]), Number(m[2]), Number(m[3])] } : null;
}

const versionBelow = (v: readonly number[], min: readonly number[]) => {
  for (let i = 0; i < min.length; i++) if (v[i] !== min[i]) return v[i] < min[i];
  return false;
};

/** PlantUML's `-stdrpt:2` lines: `<source>:<line>:error:<message>`. */
export function parseProblems(stderr: string): RenderProblem[] {
  const problems: RenderProblem[] = [];
  for (const raw of stderr.split(/\r?\n/)) {
    const m = /^(?:.*?):(\d+):error:(.*)$/i.exec(raw.trim());
    if (m) problems.push({ line: Number(m[1]), message: m[2].trim() });
  }
  return problems;
}

interface RunResult { code: number | null; stdout: Buffer; stderr: Buffer; error?: NodeJS.ErrnoException; timedOut?: boolean }

function run(file: string, args: string[], opts: { env: NodeJS.ProcessEnv; cwd?: string; input?: string; timeoutMs: number }): Promise<RunResult> {
  return new Promise((resolve) => {
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let settled = false;
    let timedOut = false;
    let child: ChildProcess;
    const finish = (r: Partial<RunResult>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: null, stdout: Buffer.concat(out), stderr: Buffer.concat(err), ...r });
    };
    const timer = setTimeout(() => { timedOut = true; child?.kill('SIGKILL'); }, opts.timeoutMs);
    try {
      child = spawn(file, args, { env: opts.env, cwd: opts.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      finish({ error: e as NodeJS.ErrnoException });
      return;
    }
    child.stdout!.on('data', (d: Buffer) => out.push(d));
    child.stderr!.on('data', (d: Buffer) => err.push(d));
    child.on('error', (e) => finish({ error: e as NodeJS.ErrnoException }));
    child.on('close', (code) => finish({ code, timedOut }));
    child.stdin!.on('error', () => undefined); // the child may exit before reading all of stdin
    child.stdin!.end(opts.input ?? '');
  });
}

const firstLines = (buf: Buffer, n = 3) => buf.toString('utf8').split(/\r?\n/).filter((l) => l.trim()).slice(0, n).join(' / ');

/** `java` and `dot` are only checked for a locally installed PlantUML; a container brings its own. */
async function probeTool(file: string, args: string[], env: NodeJS.ProcessEnv, missing: string): Promise<string | null> {
  const r = await run(file, args, { env, timeoutMs: PROBE_TIMEOUT_MS });
  return r.error || r.code !== 0 ? missing : null;
}

export interface Renderer { render(source: string): Promise<Rendered>; ready(): Promise<string> }

/**
 * `cmd` and `baseEnv` default to GOOD7OB_PLANTUML_CMD (else `plantuml`) and the process environment.
 * The dependency check runs once per renderer, on the first use.
 */
export function createRenderer(cmd: string | undefined = process.env[PLANTUML_CMD_ENV], baseEnv: NodeJS.ProcessEnv = process.env): Renderer {
  const tokens = splitCommand((cmd ?? '').trim() || 'plantuml');
  const env = safeEnv(baseEnv);
  let readiness: Promise<string> | undefined;

  const check = async (): Promise<string> => {
    const container = isContainerTool(tokens[0]);
    const problems: string[] = [];
    const inv = buildInvocation(tokens, ['-version']);
    const r = await run(inv.file, inv.args, { env, timeoutMs: PROBE_TIMEOUT_MS });
    let version = '';
    if (r.error?.code === 'ENOENT') {
      problems.push(container ? `找不到 ${tokens[0]}（需要安装并启动 Docker）` : `找不到 PlantUML 命令: ${tokens[0]}`);
    } else if (r.error || r.code !== 0) {
      problems.push(`PlantUML 无法运行（${r.timedOut ? `${PROBE_TIMEOUT_MS / 1000} 秒内没有响应` : r.error?.message ?? `退出码 ${r.code}`}）${firstLines(r.stderr) ? `: ${firstLines(r.stderr)}` : ''}`);
    } else {
      const v = parseVersion(`${r.stdout}\n${r.stderr}`);
      if (!v) problems.push('无法识别 PlantUML 版本，无法确认它支持 SANDBOX 安全档位');
      else if (versionBelow(v.parts, MIN_VERSION)) problems.push(`PlantUML ${v.text} 版本过低，需要 ${MIN_VERSION.join('.')} 或更高才能确认 SANDBOX 安全档位`);
      else version = v.text;
    }
    if (!container) {
      const [java, dot] = await Promise.all([
        probeTool('java', ['-version'], env, '找不到 Java（PlantUML 需要）'),
        probeTool('dot', ['-V'], env, '找不到 Graphviz 的 dot 命令（PlantUML 画图需要）'),
      ]);
      problems.push(...[java, dot].filter((p): p is string => p !== null));
    }
    if (problems.length) throw new SetupError(`无法在本机渲染，已拒绝：\n  - ${problems.join('\n  - ')}\n${INSTALL_HINT}`);
    return version;
  };

  const ready = () => (readiness ??= check());

  return {
    ready,
    async render(source: string): Promise<Rendered> {
      const version = await ready();
      const inv = buildInvocation(tokens, ['-pipe', '-tpng', '-failonerror', '-stdrpt:2', '-charset', 'UTF-8']);
      // an empty working directory: even if a profile let it, there is no neighbouring file to include
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'g7b-plantuml-'));
      try {
        const r = await run(inv.file, inv.args, { env, cwd, input: source, timeoutMs: RENDER_TIMEOUT_MS });
        if (r.timedOut) throw new RenderError(`渲染超时（${RENDER_TIMEOUT_MS / 1000} 秒）`);
        if (r.error) throw new RenderError(`无法启动 PlantUML: ${r.error.message}`);
        const stderr = r.stderr.toString('utf8');
        if (r.code !== 0) {
          const problems = parseProblems(stderr);
          throw new RenderError(problems.length ? 'PlantUML 渲染失败' : `PlantUML 渲染失败（退出码 ${r.code}）${firstLines(r.stderr, 5) ? `: ${firstLines(r.stderr, 5)}` : ''}`, problems);
        }
        if (r.stdout.length < PNG_MAGIC.length || !r.stdout.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
          throw new RenderError(`PlantUML 没有输出 PNG${firstLines(r.stderr) ? `: ${firstLines(r.stderr)}` : ''}`);
        }
        return { png: r.stdout, version };
      } finally {
        fs.rmSync(cwd, { recursive: true, force: true });
      }
    },
  };
}

/** One-line-per-problem text for a failed render, with PlantUML's own line numbers. */
export function describeRenderError(e: RenderError): string {
  return e.problems.length
    ? `${e.message}\n${e.problems.map((p) => `  第 ${p.line} 行: ${p.message}`).join('\n')}`
    : e.message;
}

/**
 * Test harness for command groups: runs argv through a fresh commander program
 * whose HTTP layer (the real ApiClient, so envelope unwrapping and business-error
 * handling are exercised) is stubbed at the axios instance. Captures stdout,
 * stderr and the exit code instead of touching the process.
 */

import { Command, CommanderError } from 'commander';
import { AxiosResponse } from 'axios';
import { SpyInstance, vi } from 'vitest';
import apiClient from '../../services/ApiClient';

type Method = 'get' | 'post' | 'put' | 'delete';
const METHODS: Method[] = ['get', 'post', 'put', 'delete'];

export interface Envelope {
  code: number;
  msg?: string;
  success?: boolean;
  data?: unknown;
}

export const ok = (data: unknown): Envelope => ({ code: 200, msg: '操作成功', success: true, data });
export const bizError = (code: number, msg = 'boom'): Envelope => ({ code, msg, success: false });

/** One envelope for every call, or a function choosing it per call (multi-request commands like `use --dry-run`). */
export type Responder = Envelope | ((method: Method, url: string) => Envelope);

export interface CliRun {
  stdout: string;
  stderr: string;
  /** undefined when the command finished without exiting non-zero */
  exitCode: number | undefined;
  http: Record<Method, SpyInstance>;
}

class ExitSignal extends Error {
  constructor(public readonly status: number) {
    super(`exit ${status}`);
  }
}

export async function runCli(
  register: (program: Command) => void,
  args: string[],
  response: Responder = ok(null)
): Promise<CliRun> {
  const http = apiClient['instance'];
  const reply = (m: Method, url: string) =>
    ({ data: typeof response === 'function' ? response(m, url) : response } as AxiosResponse);
  const spies = Object.fromEntries(
    METHODS.map((m) => [m, vi.spyOn(http, m).mockImplementation((async (url: string) => reply(m, url)) as never)])
  ) as Record<Method, SpyInstance>;

  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void out.push(a.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void err.push(a.join(' ')));
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new ExitSignal(code ?? 0);
  }) as never);

  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: (s) => void out.push(s), writeErr: (s) => void err.push(s) });
  register(program);

  let exitCode: number | undefined;
  try {
    await program.parseAsync(['node', 'good7ob', ...args]);
  } catch (e) {
    if (e instanceof ExitSignal) exitCode = e.status;
    else if (e instanceof CommanderError) exitCode = e.exitCode;
    else throw e;
  }
  return { stdout: out.join('\n'), stderr: err.join('\n'), exitCode, http: spies };
}

export function noHttpCalls(run: CliRun): boolean {
  return METHODS.every((m) => run.http[m].mock.calls.length === 0);
}

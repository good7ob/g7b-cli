/**
 * Hand a claimed task to the local agent: a signed webhook (Hermes webhook adapter)
 * or a detached shell command. Both throw on failure; the caller releases the task.
 */

import axios from 'axios';
import { spawn } from 'child_process';
import { createHmac } from 'crypto';

export interface ForwardTask {
  id: number;
  taskNo: string | number | null;
  name: string;
  projectId: number | null;
  claimedAtMs: number;
}

const ALLOWED_PLACEHOLDERS = new Set(['taskId', 'taskNo']);

/** Only {taskId} / {taskNo} may appear: anything else would let user text (task names) reach the shell. */
export function validateCommandTemplate(template: string): void {
  const bad = Array.from(template.matchAll(/\{([^{}]*)\}/g))
    .map((m) => m[1])
    .filter((name) => !ALLOWED_PLACEHOLDERS.has(name));
  if (bad.length) {
    throw new Error(`agent.forward.command 只允许 {taskId} 和 {taskNo} 占位符，发现: ${bad.map((b) => `{${b}}`).join(', ')}`);
  }
}

export function renderCommand(template: string, task: { id: number; taskNo: string | number | null }): string {
  validateCommandTemplate(template);
  const values: Record<string, string> = { taskId: String(task.id), taskNo: String(task.taskNo ?? '') };
  for (const [k, v] of Object.entries(values)) {
    // These go into a shell line unquoted, so refuse anything but plain id characters.
    if (template.includes(`{${k}}`) && !/^[A-Za-z0-9_-]+$/.test(v)) {
      throw new Error(`${k} 含非法字符，拒绝代入命令: ${JSON.stringify(v)}`);
    }
  }
  return template.replace(/\{(taskId|taskNo)\}/g, (_, k: string) => values[k]);
}

export function sign(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

export async function forwardWebhook(url: string, secret: string, task: ForwardTask, nowMs = Date.now()): Promise<void> {
  const body = JSON.stringify({
    task_id: task.id,
    task_no: task.taskNo,
    name: task.name,
    project_id: task.projectId,
    event: 'claimed',
  });
  const timestamp = String(Math.floor(nowMs / 1000));
  let status: number;
  try {
    const res = await axios.post(url, body, {
      timeout: 10_000,
      validateStatus: () => true,
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Timestamp': timestamp,
        'X-Webhook-Signature-V2': sign(secret, timestamp, body),
        'X-Request-ID': `good7ob-task-${task.id}-${task.claimedAtMs}`,
      },
    });
    status = res.status;
  } catch (e) {
    throw new Error(`webhook 请求失败: ${(e as Error).message}`);
  }
  if (status < 200 || status >= 300) throw new Error(`webhook 返回 HTTP ${status}`);
}

/** Starts the command detached; failure = spawn error or non-zero exit within `watchMs`. */
export function forwardCommand(template: string, task: ForwardTask, watchMs = 2000): Promise<void> {
  const command = renderCommand(template, task);
  return new Promise((resolve, reject) => {
    const child = spawn(command, { shell: true, detached: true, stdio: 'ignore' });
    const timer = setTimeout(() => {
      child.removeAllListeners();
      child.unref();
      resolve();
    }, watchMs);
    child.once('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`命令启动失败: ${e.message}`));
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`命令 ${watchMs}ms 内退出 (code=${code}${signal ? `, signal=${signal}` : ''}): ${command}`));
    });
  });
}

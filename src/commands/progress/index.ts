import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { InputError, parseId } from '../../utils/cliHelpers';

/**
 * 研发进度台账（good7ob-进度台账CLI设计）。规则与存储都在后端：
 * 每次变更写入 progress_ledger_event（只追加，带理由）并同步更新 progress_ledger_item。
 */

/** Weighted progress and done/estimate may legitimately differ; past this gap, say so. */
const DRIFT_WARN_POINTS = 10;
const KINDS = ['requirement', 'design', 'task', 'test'];
const REASON_MIN = 5;

interface ProductOpts {
  product?: string;
}

function productId(opts: ProductOpts): number {
  return parseId(opts.product ?? process.env.GOOD7OB_PRODUCT_ID, '--product（或环境变量 GOOD7OB_PRODUCT_ID）');
}

function base(opts: ProductOpts): string {
  return `/progress-ledger/products/${productId(opts)}`;
}

function requireReason(reason: string | undefined): string {
  const trimmed = (reason ?? '').trim();
  if (trimmed.length < REASON_MIN) throw new InputError(`变更理由至少 ${REASON_MIN} 个字，便于日后回溯评估`);
  return trimmed;
}

function parseNumber(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (value.trim() === '' || !Number.isFinite(n)) throw new InputError(`${name} 必须是数字，实际 ${value}`);
  return n;
}

function fail(what: string, e: unknown): never {
  console.error(`✗ ${what}:`, e instanceof Error ? e.message : String(e));
  process.exit(1);
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function pct(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : `${n.toFixed(1)}%`;
}

function changesText(op: string, changes: Record<string, { from: unknown; to: unknown }>): string {
  return Object.entries(changes)
    .map(([field, c]) => (op === 'add' ? `${field}=${c.to}` : `${field} ${c.from} → ${c.to}`))
    .join('，');
}

function printSummary(s: Record<string, any>): void {
  console.log(`${'类型'.padEnd(12)}${'项数'.padStart(6)}${'总预估h'.padStart(10)}${'剩余h'.padStart(10)}${'已完成h'.padStart(10)}${'加权进度'.padStart(10)}`);
  for (const k of [...KINDS, 'all']) {
    const t = s[k];
    const done = t.estimateH - t.remainingH;
    console.log(`${k.padEnd(12)}${String(t.items).padStart(6)}${fmt(t.estimateH).padStart(10)}${fmt(t.remainingH).padStart(10)}${fmt(done).padStart(10)}${pct(t.weightedProgress).padStart(10)}`);
  }
  const all = s.all;
  if (all.weightedProgress !== null && all.estimateH > 0) {
    const byRemaining = ((all.estimateH - all.remainingH) / all.estimateH) * 100;
    if (Math.abs(byRemaining - all.weightedProgress) > DRIFT_WARN_POINTS) {
      console.log(`\n⚠ 加权进度 ${pct(all.weightedProgress)} 与 按剩余推算 ${pct(byRemaining)} 相差超过 ${DRIFT_WARN_POINTS} 个百分点，请核对各项的进度与剩余是否同步`);
    }
  }
}

function addProductOption(cmd: Command): Command {
  return cmd.option('--product <id>', '产品 ID（或环境变量 GOOD7OB_PRODUCT_ID）');
}

export function registerProgressCommands(program: Command) {
  const cmd = program
    .command('progress')
    .description('研发进度台账：需求 / 设计 / 任务 / 测试的进度、总预估、剩余，每次变更必须写理由（数据存于后端数据库）');

  addProductOption(cmd.command('add <id>')
    .description('登记一个条目')
    .requiredOption('--kind <kind>', `类型：${KINDS.join(' | ')}`)
    .requiredOption('--title <title>', '名称')
    .requiredOption('--estimate <hours>', '总预估（小时）')
    .requiredOption('--remaining <hours>', '剩余（小时）')
    .option('--progress <percent>', '进度 0..100，默认 0')
    .requiredOption('--reason <text>', '登记理由（≥5 字）'))
    .action(async (id, o) => {
      try {
        const ev = await apiClient.post(`${base(o)}/events`, {
          op: 'add', itemId: id, kind: o.kind, title: o.title,
          progress: parseNumber(o.progress, '--progress') ?? 0,
          estimateH: parseNumber(o.estimate, '--estimate'),
          remainingH: parseNumber(o.remaining, '--remaining'),
          reason: requireReason(o.reason),
        });
        console.log(`✓ 已登记 ${id}（#${ev.seq}）`);
      } catch (e) { fail('登记失败', e); }
    });

  addProductOption(cmd.command('update <id>')
    .description('更新条目的进度、总预估或剩余（至少一项）')
    .option('--progress <percent>', '进度 0..100')
    .option('--estimate <hours>', '总预估（小时）')
    .option('--remaining <hours>', '剩余（小时）')
    .option('--title <title>', '名称')
    .requiredOption('--reason <text>', '变更理由（≥5 字），如：评审新增一个验收场景，估算上调 4h'))
    .action(async (id, o) => {
      try {
        const body = {
          op: 'update', itemId: id, title: o.title,
          progress: parseNumber(o.progress, '--progress'),
          estimateH: parseNumber(o.estimate, '--estimate'),
          remainingH: parseNumber(o.remaining, '--remaining'),
          reason: requireReason(o.reason),
        };
        const ev = await apiClient.post(`${base(o)}/events`, body);
        console.log(`✓ 已更新 ${id}（#${ev.seq}）：${changesText('update', ev.changes)}`);
      } catch (e) { fail('更新失败', e); }
    });

  addProductOption(cmd.command('remove <id>')
    .description('移出范围（保留在日志中，可回溯）')
    .requiredOption('--reason <text>', '移出理由（≥5 字）'))
    .action(async (id, o) => {
      try {
        const ev = await apiClient.post(`${base(o)}/events`, { op: 'remove', itemId: id, reason: requireReason(o.reason) });
        console.log(`✓ 已移出 ${id}（#${ev.seq}）`);
      } catch (e) { fail('移出失败', e); }
    });

  addProductOption(cmd.command('show')
    .description('列出当前条目')
    .option('--kind <kind>', '只看某类')
    .option('--json', '输出 JSON'))
    .action(async (o) => {
      try {
        const items = (await apiClient.get(`${base(o)}/items`, { kind: o.kind })) ?? [];
        if (o.json) return console.log(JSON.stringify(items, null, 2));
        items.forEach((i: any) => console.log(`${i.itemId.padEnd(16)}${i.kind.padEnd(13)}${String(i.progress).padStart(4)}%  预估 ${fmt(i.estimateH).padStart(6)}h  剩余 ${fmt(i.remainingH).padStart(6)}h  ${i.title}`));
      } catch (e) { fail('读取失败', e); }
    });

  addProductOption(cmd.command('summary')
    .description('按类型汇总：总预估、剩余、已完成、加权进度')
    .option('--json', '输出 JSON'))
    .action(async (o) => {
      try {
        const s = await apiClient.get(`${base(o)}/summary`);
        if (o.json) return console.log(JSON.stringify(s, null, 2));
        printSummary(s);
      } catch (e) { fail('汇总失败', e); }
    });

  addProductOption(cmd.command('changes')
    .description('变更记录：每次变更的理由、操作人，以及对总预估与剩余的影响，用于回溯评估')
    .option('--item <id>', '只看某条目')
    .option('--kind <kind>', '只看某类')
    .option('--since <date>', '起始日期 YYYY-MM-DD')
    .option('--json', '输出 JSON'))
    .action(async (o) => {
      try {
        const rows = (await apiClient.get(`${base(o)}/events`, { itemId: o.item, kind: o.kind, since: o.since })) ?? [];
        if (o.json) return console.log(JSON.stringify(rows, null, 2));
        rows.forEach((r: any) => {
          const day = String(r.at).slice(0, 10);
          const sign = (n: number) => (n >= 0 ? '+' : '') + fmt(n);
          console.log(`#${r.seq}  ${day}  user:${r.actorUserId}  ${r.itemId}  预估${sign(r.deltaEstimateH)}h 剩余${sign(r.deltaRemainingH)}h\n    ${changesText(r.op, r.changes)}\n    理由：${r.reason}`);
        });
        const net = rows.reduce((s: number, r: any) => s + r.deltaEstimateH, 0);
        console.log(`\n共 ${rows.length} 条变更，总预估净变化 ${net >= 0 ? '+' : ''}${fmt(net)}h`);
      } catch (e) { fail('读取变更失败', e); }
    });

  addProductOption(cmd.command('verify')
    .description('校验：重放日志并与当前条目表比对'))
    .action(async (o) => {
      try {
        const r = await apiClient.get(`${base(o)}/verify`);
        console.log(`✓ 台账有效：${r.events} 条变更，${r.items} 个当前条目`);
      } catch (e) { fail('台账校验失败', e); }
    });
}

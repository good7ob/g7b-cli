/**
 * `uc import`, local half (prd-0180 FP-12, rp-ucase-0085～0087, 0091): read the text of an existing PlantUML use case
 * diagram and map it to use cases. Pure text processing: nothing is rendered, uploaded or executed (`!include`,
 * `%getenv()` and every other directive is just a line that is skipped), and no network is involved.
 *
 * Only three kinds of line are understood (rp-ucase-0086): `actor "name" as ALIAS`, `usecase "name" as ALIAS`, and
 * `ACTOR --> USECASE` links; plus the dependency arrows `A ..> B : <<include>>` / `<<extend>>`. Groups and notes are
 * tracked only to be written into the note of the use case; any other dashed arrow is kept as text for that note.
 */
import * as path from 'path';
import { MAX_ACTOR_NAME, MAX_GOAL, MAX_NOTE, actorKey } from './input';

export interface Problem { file: string; line: number; text: string; reason: string }
export interface ActorDef { alias: string; name: string; line: number; error?: string }
export interface NodeDef { alias: string; goal: string; line: number; group: string }
export interface Link { actor: string; node: string; line: number }
export type DepKind = 'include' | 'extend' | 'other';
export interface Dep { from: string; to: string; kind: DepKind; label: string; line: number }
export interface Diagram {
  file: string; title?: string; actors: ActorDef[]; nodes: NodeDef[]; links: Link[]; deps: Dep[];
  notes: Array<{ target: string; text: string }>; problems: Problem[];
}

const ALIAS = '[\\p{L}\\p{N}_.]+';
const NAME = '"((?:[^"\\\\]|\\\\.)*)"';
const DECL = (kw: string) => new RegExp(`^${kw}\\s+${NAME}\\s+as\\s+(${ALIAS})\\s*$`, 'u');
const ACTOR_RE = DECL('actor');
const USECASE_RE = DECL('usecase');
const LINK_RE = new RegExp(`^(${ALIAS})\\s*-+>\\s*(${ALIAS})\\s*(?::\\s*(.*))?$`, 'u');
const DEP_RE = new RegExp(`^(${ALIAS})\\s*\\.\\.+>\\s*(${ALIAS})\\s*(?::\\s*(.*))?$`, 'u');
const GROUP_RE = /^(rectangle|package|folder|frame|node|cloud|database|component|together)\b(.*)\{\s*$/i;
const NOTE_OF_RE = /^note\s+(?:left|right|top|bottom)\s+of\s+(\S+?)\s*(?::\s*(.*))?$/i;

/** `\n` (the two characters) is a line break in a PlantUML name; `\"` and `\\` are escapes. Other escapes stay as written. */
export function decodeName(raw: string): string {
  return raw.replace(/\\(.)/g, (all, c: string) => (/[nlr]/.test(c) ? '\n' : c === '"' || c === '\\' ? c : all));
}

const cpLength = (s: string) => Array.from(s).length;
const oneLine = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean).join(' ');

function groupName(rest: string, keyword: string): string {
  const quoted = new RegExp(NAME).exec(rest);
  if (quoted) return oneLine(decodeName(quoted[1]));
  return rest.replace(/\bas\b.*$/i, '').trim() || keyword;
}

interface Pending { kind: 'link' | 'dep'; a: string; b: string; label: string; line: number; raw: string }

/** Notes whose text cannot be bound to a node are dropped; the node-bound ones go into that node's note. */
export function parsePuml(text: string, file: string): Diagram {
  const d: Diagram = { file, actors: [], nodes: [], links: [], deps: [], notes: [], problems: [] };
  const problem = (line: number, raw: string, reason: string) => void d.problems.push({ file, line, text: raw.trim().slice(0, 120), reason });
  const lines = text.replace(/\r\n?/g, '\n').replace(/^﻿/, '').split('\n');
  const groups: Array<string | null> = [];
  const defined = new Map<string, 'actor' | 'node'>();
  const pending: Pending[] = [];
  let blockComment = false;
  let note: { target?: string; text: string[] } | null = null;
  let titleOpen = false;

  const declare = (alias: string, kind: 'actor' | 'node', line: number, raw: string): boolean => {
    if (defined.has(alias)) { problem(line, raw, `别名 ${alias} 重复定义，忽略这一行`); return false; }
    defined.set(alias, kind);
    return true;
  };

  lines.forEach((raw, idx) => {
    const line = idx + 1;
    const s = raw.trim();
    if (blockComment) { if (s.includes("'/")) blockComment = false; return; }
    if (s.startsWith("/'")) { blockComment = !s.includes("'/", 2); return; }
    if (note) {
      if (/^end\s*note$/i.test(s)) {
        if (note.target) d.notes.push({ target: note.target, text: note.text.join(' ').trim() });
        note = null;
      } else if (s) note.text.push(s);
      return;
    }
    if (titleOpen) {
      if (/^end\s*title$/i.test(s)) titleOpen = false;
      else if (s) d.title = d.title ? `${d.title} ${s}` : s;
      return;
    }
    if (!s || s.startsWith("'")) return;

    const title = /^title(?:\s+(.*))?$/i.exec(s);
    if (title) { if (title[1]) d.title = title[1].trim(); else titleOpen = true; return; }

    const noteOf = NOTE_OF_RE.exec(s);
    if (noteOf) {
      if (noteOf[2] !== undefined) d.notes.push({ target: noteOf[1], text: noteOf[2].trim() });
      else note = { target: noteOf[1], text: [] };
      return;
    }
    if (/^note\b/i.test(s)) { if (!s.includes(':')) note = { text: [] }; return; } // floating note: its text is skipped

    if (/^actor\b/i.test(s)) {
      const m = ACTOR_RE.exec(s);
      if (!m) return problem(line, s, '不是 actor "名称" as 别名 的写法');
      if (!declare(m[2], 'actor', line, s)) return;
      const name = decodeName(m[1]).split('\n')[0].trim();
      const error = !name ? '角色名为空' : cpLength(name) > MAX_ACTOR_NAME ? `角色名超过 ${MAX_ACTOR_NAME} 字` : undefined;
      if (error) problem(line, s, error);
      d.actors.push({ alias: m[2], name, line, error });
      return;
    }
    if (/^usecase\b/i.test(s)) {
      const m = USECASE_RE.exec(s);
      if (!m) return problem(line, s, '不是 usecase "名称" as 别名 的写法');
      if (!declare(m[2], 'node', line, s)) return;
      d.nodes.push({ alias: m[2], goal: oneLine(decodeName(m[1])), line, group: groups.filter(Boolean).join(' / ') });
      return;
    }
    if (s.startsWith('}')) { groups.pop(); return; }
    const group = GROUP_RE.exec(s);
    if (group) { groups.push(/^(rectangle|package)$/i.test(group[1]) ? groupName(group[2], group[1]) : null); return; }
    if (s.endsWith('{')) { groups.push(null); return; }

    const dep = DEP_RE.exec(s);
    if (dep) { pending.push({ kind: 'dep', a: dep[1], b: dep[2], label: (dep[3] ?? '').trim(), line, raw: s }); return; }
    const link = LINK_RE.exec(s);
    if (link) { pending.push({ kind: 'link', a: link[1], b: link[2], label: '', line, raw: s }); return; }
    if (/-+>|\.\.+>/.test(s)) problem(line, s, '无法识别的连线写法');
    // everything else (skinparam, direction, @startuml, hide, !include ...) is deliberately ignored
  });

  resolve(d, defined, pending, problem);
  d.problems.sort((a, b) => a.line - b.line);
  return d;
}

/** Links and dependencies may point at aliases defined further down, so they are resolved after the whole file. */
function resolve(d: Diagram, defined: Map<string, 'actor' | 'node'>, pending: Pending[], problem: (line: number, raw: string, reason: string) => void): void {
  for (const p of pending) {
    const missing = [p.a, p.b].find((x) => !defined.has(x));
    if (missing) { problem(p.line, p.raw, `别名 ${missing} 没有定义`); continue; }
    if (p.kind === 'link') {
      if (defined.get(p.a) === 'actor' && defined.get(p.b) === 'node') d.links.push({ actor: p.a, node: p.b, line: p.line });
      else problem(p.line, p.raw, '实线只认「角色 --> 用例」');
      continue;
    }
    if (defined.get(p.a) !== 'node' || defined.get(p.b) !== 'node') { problem(p.line, p.raw, '虚线依赖两端必须是用例'); continue; }
    const l = p.label.toLowerCase();
    d.deps.push({ from: p.a, to: p.b, label: p.label, line: p.line, kind: l.includes('<<include>>') ? 'include' : l.includes('<<extend>>') ? 'extend' : 'other' });
  }
}

// ── mapping (rp-ucase-0087, 0091) ──

/** The comparison the server uses for roles (ignore case and all whitespace) and goals (ignore case, trimmed). */
export { actorKey };
export const goalKey = (s: string) => s.trim().toLowerCase();
export const caseKey = (actor: string, goal: string) => `${actorKey(actor)}\u0000${goalKey(goal)}`;

export interface PlannedCase { file: string; line: number; node: string; actor: string; goal: string; note: string; key: string }
export interface PlannedInclude { file: string; line: number; fromKey: string; toKey: string; from: string; to: string; actor: string }
export interface SkippedDep { file: string; line: number; text: string; reason: string; kind: DepKind }
export interface FilePlan {
  file: string; actors: number; nodes: number; cases: PlannedCase[]; noRole: Array<{ file: string; line: number; goal: string }>;
  invalid: Problem[]; includes: PlannedInclude[]; skippedDeps: SkippedDep[]; unparsed: Problem[]; otherDeps: number; plainIncludeExtend: number;
}

const EXTEND_REASON = 'extend 缺少触发条件（rp-ucase-0030），不导入';
const INCLUDE_ONE_END = 'include 的一端没有导入为用例（没有角色或名称无效），关系不导入';
const INCLUDE_NO_COMMON_ACTOR = 'include 两端没有同一个角色，无法确定对应关系，不导入';

function buildNote(d: Diagram, n: NodeDef, imported: Set<Dep>): string {
  const goalOf = (alias: string) => d.nodes.find((x) => x.alias === alias)?.goal ?? alias;
  const head = [`导入自 ${path.basename(d.file)}`];
  if (d.title) head.push(`图标题：${d.title}`);
  if (n.group) head.push(`分组：${n.group}`);
  const extras: string[] = [];
  for (const dep of d.deps) {
    if (imported.has(dep) || (dep.from !== n.alias && dep.to !== n.alias)) continue;
    const label = dep.label || '依赖';
    extras.push(dep.from === n.alias ? `未转换的依赖：本用例 ${label} ${goalOf(dep.to)}` : `未转换的依赖：${goalOf(dep.from)} ${label} 本用例`);
  }
  for (const nt of d.notes) if (nt.target === n.alias && nt.text) extras.push(`图中备注：${nt.text}`);
  const all = [...head, ...extras].join('\n');
  if (cpLength(all) <= MAX_NOTE) return all;
  const tail = '\n…（其余略）';
  return Array.from(all).slice(0, MAX_NOTE - cpLength(tail)).join('') + tail; // ponytail: the source lines come first; extras are what gets cut
}

export function planDiagram(d: Diagram): FilePlan {
  const plan: FilePlan = {
    file: d.file, actors: d.actors.length, nodes: d.nodes.length, cases: [], noRole: [], invalid: [], includes: [], skippedDeps: [],
    unparsed: d.problems, otherDeps: 0, plainIncludeExtend: 0,
  };
  const actorOf = new Map(d.actors.map((a) => [a.alias, a]));
  const rolesOf = new Map<string, ActorDef[]>();
  for (const l of d.links) rolesOf.set(l.node, [...(rolesOf.get(l.node) ?? []), actorOf.get(l.actor) as ActorDef]);
  const goalOf = (alias: string) => d.nodes.find((x) => x.alias === alias)?.goal ?? alias;

  const ready: Array<{ n: NodeDef; actor: ActorDef }> = [];
  for (const n of d.nodes) {
    const roles = rolesOf.get(n.alias) ?? [];
    if (!roles.length) { plan.noRole.push({ file: d.file, line: n.line, goal: n.goal }); continue; }
    const bad = (reason: string) => plan.invalid.push({ file: d.file, line: n.line, text: n.goal.slice(0, 40), reason });
    if (!n.goal) bad('用例名称为空');
    else if (cpLength(n.goal) > MAX_GOAL) bad(`目标 ${cpLength(n.goal)} 字，超过 ${MAX_GOAL} 字（不截断）`);
    else roles.forEach((actor) => (actor.error ? bad(`连到的角色「${actor.name.slice(0, 20)}」无效（${actor.error}），该角色下的用例未导入`) : ready.push({ n, actor })));
  }

  const imported = new Set<Dep>();
  for (const dep of d.deps) {
    if (dep.kind === 'other') { plan.otherDeps++; if (/include|extend/i.test(dep.label)) plan.plainIncludeExtend++; continue; }
    const text = `${goalOf(dep.from)} ..> ${goalOf(dep.to)}`;
    if (dep.kind === 'extend') { plan.skippedDeps.push({ file: d.file, line: dep.line, text, reason: EXTEND_REASON, kind: 'extend' }); continue; }
    const from = ready.filter((c) => c.n.alias === dep.from);
    const to = ready.filter((c) => c.n.alias === dep.to);
    const pairs = from.flatMap((f) => to.filter((t) => actorKey(t.actor.name) === actorKey(f.actor.name)).map((t) => [f, t] as const));
    if (!pairs.length) {
      plan.skippedDeps.push({ file: d.file, line: dep.line, text, reason: !from.length || !to.length ? INCLUDE_ONE_END : INCLUDE_NO_COMMON_ACTOR, kind: 'include' });
      continue;
    }
    imported.add(dep);
    for (const [f, t] of pairs) {
      plan.includes.push({ file: d.file, line: dep.line, from: f.n.goal, to: t.n.goal, actor: f.actor.name, fromKey: caseKey(f.actor.name, f.n.goal), toKey: caseKey(t.actor.name, t.n.goal) });
    }
  }
  for (const { n, actor } of ready) {
    plan.cases.push({ file: d.file, line: n.line, node: n.alias, actor: actor.name, goal: n.goal, note: buildNote(d, n, imported), key: caseKey(actor.name, n.goal) });
  }
  return plan;
}

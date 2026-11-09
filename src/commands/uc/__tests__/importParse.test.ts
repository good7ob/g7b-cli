import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { decodeName, parsePuml, planDiagram } from '../importParse';

const fx = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const parse = (body: string, file = 't.puml') => parsePuml(`@startuml\n${body}\n@enduml`, file);

describe('rp-ucase-0086 parser: the three kinds of line', () => {
  it('reads actor, usecase and actor --> usecase links, with aliases defined after use', () => {
    const d = parse('U --> A\nactor "用户" as U\nusecase "登录" as A\nU --> B : 备注\nusecase "退出" as B');
    expect(d.actors).toEqual([{ alias: 'U', name: '用户', line: 3, error: undefined }]);
    expect(d.nodes.map((n) => [n.alias, n.goal])).toEqual([['A', '登录'], ['B', '退出']]);
    expect(d.links.map((l) => [l.actor, l.node])).toEqual([['U', 'A'], ['U', 'B']]);
    expect(d.problems).toEqual([]);
  });

  it('decodes \\n to a line break and \\" to a quote; the actor keeps only its first line; the goal joins lines with a space', () => {
    const d = parse('actor "运营人员\\n(内部使用)" as AI\nusecase "领取任务\\n读取\\"上下文\\"" as T1');
    expect(d.actors[0].name).toBe('运营人员');
    expect(d.nodes[0].goal).toBe('领取任务 读取"上下文"');
    expect(decodeName('a\\\\b\\tc')).toBe('a\\b\\tc');
  });

  it('handles CRLF and a BOM', () => {
    const d = parsePuml('﻿@startuml\r\nactor "用户" as U\r\nusecase "登录" as A\r\nU --> A\r\n@enduml\r\n', 't.puml');
    expect(d.actors).toHaveLength(1);
    expect(d.links).toHaveLength(1);
    expect(d.problems).toEqual([]);
  });

  it('ignores comments, skinparam, direction and preprocessor lines without executing or reporting them', () => {
    const d = parse("' actor \"注释\" as X\n/' block\nactor \"块注释\" as Y\n'/\nskinparam shadowing false\nleft to right direction\n!include /etc/passwd\n!define X 1\nhide footbox\nactor \"用户\" as U");
    expect(d.actors.map((a) => a.alias)).toEqual(['U']);
    expect(d.problems).toEqual([]);
  });

  it('reports malformed declarations, undefined aliases and unrecognised arrows with file and line', () => {
    const d = parse('actor 用户 as U\nusecase "登录" A\nactor "用户" as U2\nusecase "登录" as A\nU2 --> Z\nA --> U2\nU2 -> A -> A\nusecase "登录2" as A');
    expect(d.problems.map((p) => [p.line, p.file])).toEqual([[2, 't.puml'], [3, 't.puml'], [6, 't.puml'], [7, 't.puml'], [8, 't.puml'], [9, 't.puml']]);
    expect(d.problems.map((p) => p.reason)).toEqual([
      '不是 actor "名称" as 别名 的写法', '不是 usecase "名称" as 别名 的写法', '别名 Z 没有定义', '实线只认「角色 --> 用例」', '无法识别的连线写法', expect.stringContaining('重复定义'),
    ]);
  });

  it('classifies dependency arrows: <<include>>, <<extend>>, everything else', () => {
    const d = parse('usecase "a" as A\nusecase "b" as B\nA ..> B : <<include>>\nA ..> B : <<EXTEND>>\nA ..> B : 基于\nA ..> B\nA ..> B : include 前置');
    expect(d.deps.map((x) => x.kind)).toEqual(['include', 'extend', 'other', 'other', 'other']);
  });

  it('records groups (nested, non-rectangle ones ignored in the path) and titles', () => {
    const d = parse('title 用例图 · 登录（prd-0001 FP-1~2）\nrectangle "外层" {\n  package "内层" {\n    usecase "a" as A\n  }\n  usecase "b" as B\n}\nusecase "c" as C');
    expect(d.title).toBe('用例图 · 登录（prd-0001 FP-1~2）');
    expect(d.nodes.map((n) => n.group)).toEqual(['外层 / 内层', '外层', '']);
    expect(parse('title\n第一行\n第二行\nend title').title).toBe('第一行 第二行');
  });

  it('keeps note text out of the parse (an arrow inside a note is not a link) and binds node notes', () => {
    const d = parse('actor "u" as U\nusecase "a" as A\nnote right of A\n  U --> A\n  actor "x" as X\nend note\nnote bottom of A : 单行\nnote "浮动" as N1\nU --> Z\nend note');
    expect(d.actors).toHaveLength(1);
    expect(d.links).toHaveLength(0);
    expect(d.notes).toEqual([{ target: 'A', text: 'U --> A actor "x" as X' }, { target: 'A', text: '单行' }]);
    expect(d.problems).toEqual([]);
  });

  it('flags an empty or over-long actor name', () => {
    const d = parse(`actor "\\n说明" as E\nactor "${'长'.repeat(31)}" as L`);
    expect(d.problems.map((p) => p.reason)).toEqual(['角色名为空', '角色名超过 30 字']);
  });
});

describe('rp-ucase-0087 / 0091 mapping', () => {
  const plan = (body: string) => planDiagram(parse(body, '/x/图.puml'));

  it('one case per connected role; nodes without a role are listed, not imported', () => {
    const p = plan('actor "A" as A\nactor "B" as B\nusecase "x" as X\nusecase "y" as Y\nA --> X\nB --> X');
    expect(p.cases.map((c) => [c.actor, c.goal])).toEqual([['A', 'x'], ['B', 'x']]);
    expect(p.noRole).toEqual([{ file: '/x/图.puml', line: 5, goal: 'y' }]);
  });

  it('refuses a goal over 200 characters instead of cutting it, counting code points', () => {
    const p = plan(`actor "A" as A\nusecase "${'😀'.repeat(200)}" as X\nusecase "${'x'.repeat(201)}" as Y\nA --> X\nA --> Y`);
    expect(p.cases.map((c) => c.node)).toEqual(['X']);
    expect(p.invalid).toHaveLength(1);
    expect(p.invalid[0]).toMatchObject({ line: 4, reason: expect.stringContaining('201 字') });
  });

  it('a link to an invalid actor makes that role’s case invalid, not silently lost', () => {
    const p = plan(`actor "${'长'.repeat(31)}" as A\nusecase "x" as X\nA --> X`);
    expect(p.cases).toEqual([]);
    expect(p.noRole).toEqual([]);
    expect(p.invalid[0].reason).toContain('角色名超过 30 字');
  });

  it('the note records the file, the title with its basis and the group (and no FP link)', () => {
    const p = plan('title 用例图 1 · 登录（prd-0001 FP-1~3）\nactor "A" as A\nrectangle "认证" {\nusecase "x" as X\n}\nA --> X');
    expect(p.cases[0].note).toBe('导入自 图.puml\n图标题：用例图 1 · 登录（prd-0001 FP-1~3）\n分组：认证');
  });

  it('unconverted dashed dependencies and node notes go into the note; the note never exceeds 2000 characters', () => {
    const p = plan('actor "A" as A\nusecase "x" as X\nusecase "y" as Y\nA --> X\nY ..> X : 基于\nnote right of X : 重要');
    expect(p.cases[0].note).toContain('未转换的依赖：y 基于 本用例');
    expect(p.cases[0].note).toContain('图中备注：重要');
    expect(p.otherDeps).toBe(1);
    const long = plan(`actor "A" as A\nusecase "x" as X\nA --> X\nnote right of X : ${'备'.repeat(3000)}`);
    expect(Array.from(long.cases[0].note).length).toBeLessThanOrEqual(2000);
    expect(long.cases[0].note.startsWith('导入自 图.puml')).toBe(true);
  });

  it('include becomes a relation between the cases of the same role; extend is skipped and explained', () => {
    const p = plan('actor "A" as A\nactor "B" as B\nusecase "x" as X\nusecase "y" as Y\nusecase "z" as Z\nA --> X\nB --> X\nA --> Y\nB --> Y\nA --> Z\nX ..> Y : <<include>>\nX ..> Z : <<extend>>');
    expect(p.includes.map((r) => [r.actor, r.from, r.to])).toEqual([['A', 'x', 'y'], ['B', 'x', 'y']]);
    expect(p.skippedDeps).toMatchObject([{ kind: 'extend', line: 13, reason: expect.stringContaining('触发条件') }]);
    expect(p.cases.find((c) => c.goal === 'z')?.note).toContain('<<extend>>');
  });

  it('include is not imported when an end has no role or the roles differ', () => {
    const p = plan('actor "A" as A\nactor "B" as B\nusecase "x" as X\nusecase "y" as Y\nusecase "z" as Z\nA --> X\nB --> Y\nX ..> Y : <<include>>\nX ..> Z : <<include>>');
    expect(p.includes).toEqual([]);
    expect(p.skippedDeps.map((d) => d.reason)).toEqual([expect.stringContaining('没有同一个角色'), expect.stringContaining('一端没有导入')]);
  });
});

describe('synthetic fixtures with the structure of real diagrams', () => {
  const orders = fx('orders-extend-multirole.puml');
  const ordersPlan = () => planDiagram(parsePuml(orders, 'a.puml'));

  it('0086: <<extend>> is reported and not imported; a one-ended <<include>> is explained; plain include/extend labels are counted, not related', () => {
    const p = ordersPlan();
    expect(p.skippedDeps.map((d) => [d.kind, d.text, d.line])).toEqual([
      ['include', '提交订单 ..> 校验库存', 38], ['extend', '使用优惠券 ..> 提交订单', 39],
    ]);
    expect(p.skippedDeps[1].reason).toContain('触发条件');
    expect(p.otherDeps).toBe(2);
    expect(p.plainIncludeExtend).toBe(1);
    expect(p.unparsed).toEqual([]);
  });

  it('0087: a node with several roles gives one case per role; nodes without a role are listed', () => {
    const p = ordersPlan();
    expect(p.cases.map((c) => `${c.actor}:${c.goal}`)).toEqual([
      '顾客:提交订单', '客服:提交订单', '顾客:使用优惠券', '顾客:申请退款', '客服:申请退款', '店长:审批退款', '客服:查看售后记录', '店长:查看售后记录', '对账系统:每日对账',
    ]);
    expect(p.noRole.map((n) => n.goal)).toEqual(['校验库存', '待补充说明']);
  });

  it('0086: <<include>> becomes one relation, between the cases of the role both ends share', () => {
    const p = ordersPlan();
    expect(p.includes.map((r) => [r.actor, r.from, r.to])).toEqual([['客服', '查看售后记录', '申请退款']]);
  });

  it('0091: the note holds the file, the title with its basis, the nested group, unconverted dependencies and the diagram note', () => {
    const refund = ordersPlan().cases.find((c) => c.goal === '申请退款' && c.actor === '顾客');
    expect(refund?.note).toBe([
      '导入自 a.puml', '图标题：用例图 1 · 下单与售后（prd-0001 FP-1~3、prd-0002）', '分组：售后 / 退款',
      '未转换的依赖：审批退款 基于 本用例', '图中备注：退款金额超过阈值时需店长审批',
    ].join('\n')); // the imported <<include>> is not repeated in the note
    const order = ordersPlan().cases[0];
    expect(order.note).toContain('分组：下单');
    expect(order.note).toContain('未转换的依赖：本用例 <<include>> 校验库存');
    expect(order.note).toContain('未转换的依赖：使用优惠券 <<extend>> 本用例');
  });

  it('CRLF text gives exactly the same plan as LF text', () => {
    const crlf = planDiagram(parsePuml(orders.replace(/\n/g, '\r\n'), 'a.puml'));
    expect(crlf).toEqual(ordersPlan());
  });

  it('names with \\n: goals are one line, roles are the first line, notes (block and one-line) are attached', () => {
    const p = planDiagram(parsePuml(fx('newline-names.puml'), 'b.puml'));
    expect(p.cases.map((c) => `${c.actor}:${c.goal}`)).toEqual([
      '运营:创建通知 选择模板与受众', '运营:定时发送通知', '订阅用户:设置接收偏好 (渠道 / 免打扰时段)',
    ]);
    expect(p.cases[0].note).toContain('图中备注：模板需先审核 再用于发送');
    expect(p.cases[0].note).toContain('图标题：用例图 2 · 通知与偏好（prd-0003 FP-2~4、prd-0004）');
    expect(p.cases[2].note).toContain('图中备注：默认全部开启');
    expect(p.cases[1].note).toContain('未转换的依赖：本用例 基于 创建通知 选择模板与受众');
    expect(p.noRole).toEqual([]);
  });
});

// Optional check against a directory of real diagrams: GOOD7OB_UC_REAL_DIR=<dir> npx vitest run ...
const REAL_DIR = process.env.GOOD7OB_UC_REAL_DIR;
describe.skipIf(!REAL_DIR || !fs.existsSync(REAL_DIR))('every .puml under GOOD7OB_UC_REAL_DIR', () => {
  it('parses without throwing and without unparsed lines', () => {
    const dir = REAL_DIR as string;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.puml'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const p = planDiagram(parsePuml(fs.readFileSync(path.join(dir, f), 'utf8'), f));
      expect(p.unparsed, f).toEqual([]);
      expect(p.invalid, f).toEqual([]);
    }
  });
});

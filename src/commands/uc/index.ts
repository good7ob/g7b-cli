/**
 * `good7ob uc` — user use cases (prd-0180, api-0180): register and maintain use cases, actors, requested channels and
 * entry declarations, FP / test-case links and include / extend relations; `push` a PlantUML flow diagram and `render`
 * the stale pictures. Rendering happens on this machine (SANDBOX profile, see plantuml.ts); the server stores
 * the source, the PNG and the hash it was rendered from.
 *
 * `PUT /use-cases/{id}` replaces every field, so `update` reads the use case first and sends back what you did not change.
 */
import { Command, Option } from 'commander';
import * as path from 'path';
import apiClient from '../../services/ApiClient';
import {
  ErrorCodeMap, InputError, emit, guarded, parseId, requireOneOf, requireText, resolveProductId,
} from '../../utils/cliHelpers';
import { pushDiagram, planRender, runPlan } from './batch';
import { runImport } from './import';
import {
  DIAGRAM_TYPES, GAP_CODES, MAX_ACTOR_NAME, ORDERS, SORTS, STATUSES, MAX_DIAGRAM_NAME, buildCreateBody, buildEntryBody, buildRelationBody, mergeUpdateBody,
  parseChannels, parseEnumList, parseLimit, requireChanges, scopeParams, resolveActorId, resolveUseCaseId, upper, PRIORITIES,
} from './input';
import { RenderError, createRenderer, describeRenderError } from './plantuml';
import {
  Actor, DiagramRow, Metrics, OverviewRow, StatusView, UcDetail, UcListItem, UcPage, renderActors, renderBatch, renderDetail, renderDiagrams,
  renderGaps, renderMetrics, renderStatus,
  renderFpCandidates, renderList, renderOverviews, renderTestCandidates,
} from './render';
import { readSourceFile } from './source';

const CODES: ErrorCodeMap = {
  1000: '缺少必填参数',
  1001: '参数不合法',
  1002: '用例 / 对象不存在，或你看不到它所在的产品',
  2000: '暂无权限（查看需是产品所属组织成员，编辑需是组织 owner/admin；AI 员工 Key 暂不可用）',
  15001: '同一产品内已有相同角色和目标的用例',
  15002: '角色被未删除的用例引用，不能删除，只能停用',
  15003: '角色已停用，不能用于新建用例',
  15004: '入口声明的承载 FP 还没有关联到该用例，先用 uc link-fp',
  15005: '该渠道下已有相同的入口引用',
  15006: '产品内已有同名角色',
  15007: '该用例被其他用例 include / extend 引用，需要确认；确认无误后加 --confirm 重新执行',
  15008: 'include / extend 关系不能成环',
  15009: '这两个用例之间已有同类型关系',
  15010: '已经关联过了',
  15011: '该 FP 还承载着入口声明，先用 uc entry remove 删除这些入口',
  15012: '源码未通过服务端安全检查（不允许文件引入、远程地址、环境变量等）',
  15013: '用例数据在渲染期间变化了，请重新执行',
  15014: '范围内用例过多（超过 2000 条），无法实时计算状态；请加筛选条件缩小范围（--priority / --sub-module / --release / --milestone）',
};

const JSON_OPT = ['--json', 'Output as JSON'] as const;
const PRODUCT_OPT = ['--product <id>', '产品 ID（或环境变量 GOOD7OB_PRODUCT_ID；用 UC-n 编号时需要）'] as const;

const detailPath = (id: number) => `/use-cases/${id}`;
const done = (what: string, d: UcDetail) => `✓ ${what}: ${d.code} ${d.goal}`;

async function ucId(ref: string, o: { product?: string }): Promise<number> {
  return resolveUseCaseId(ref, o.product);
}

/** An FP given as an id, or as its code (`fun-org-0001`, found through the candidate search of the use case's product). */
async function resolveFunctionPointId(ref: string, id: number): Promise<number> {
  if (/^[1-9][0-9]*$/.test(ref.trim())) return parseId(ref, '<fp>');
  const detail: UcDetail = await apiClient.get(detailPath(id));
  const found: Array<{ functionPointId: number; code?: string | null }> =
    (await apiClient.get(`/products/${detail.productId}/use-case-candidates/functions`, { keyword: ref.trim(), limit: 50 })) ?? [];
  const hit = found.find((f) => (f.code ?? '').toLowerCase() === ref.trim().toLowerCase());
  if (!hit) throw new InputError(`产品 ${detail.productId} 里找不到编号为 ${ref} 的 FP（也可直接给数字 id）`);
  return hit.functionPointId;
}

async function resolveTestCaseId(ref: string, id: number): Promise<number> {
  if (/^[1-9][0-9]*$/.test(ref.trim())) return parseId(ref, '<testCase>');
  const detail: UcDetail = await apiClient.get(detailPath(id));
  const found: Array<{ testCaseId: number; caseNo?: string | null }> =
    (await apiClient.get(`/products/${detail.productId}/use-case-candidates/test-cases`, { keyword: ref.trim(), limit: 50 })) ?? [];
  const hit = found.find((t) => (t.caseNo ?? '').toLowerCase() === ref.trim().toLowerCase());
  if (!hit) throw new InputError(`产品 ${detail.productId} 里找不到编号为 ${ref} 的测试用例（也可直接给数字 id）`);
  return hit.testCaseId;
}

function registerUseCaseCommands(uc: Command): void {
  uc.command('list').description('List use cases of a product (ascending by code)')
    .option(...PRODUCT_OPT).option('--priority <p>', 'P0|P1|P2').option('--actor <id>', 'Actor id')
    .option('--sub-module <id>', 'Sub-module id').option('--channel <c>', 'WEB|APP|CLI|MCP|API')
    .option('--status <list>', `Derived status, comma separated: ${STATUSES.join('|')}`)
    .option('--gap <list>', 'Has any of these gap marks, comma separated: NO_FUNCTION_POINT|NO_ENTRY|FP_INCOMPLETE|FP_INVALID|INCLUDE_NOT_AVAILABLE|API_WITHOUT_UI|NO_DIAGRAM|DIAGRAM_NOT_FRESH|NO_TEST_CASE|TEST_FAILED|TEST_NOT_RUN')
    .option('--release <id>', 'Target release id').option('--milestone <id>', 'Target milestone id')
    .option('--sort <key>', `${SORTS.join('|')} (default code)`).option('--order <o>', 'asc|desc (default asc)')
    .option('--page <n>', 'Page (default 1)').option('--size <n>', 'Page size 1-100 (default 20)').option(...JSON_OPT)
    .action((o) => guarded('获取用例列表失败', CODES, async () => {
      const productId = resolveProductId(o.product);
      const params = {
        priority: o.priority === undefined ? undefined : upper(o.priority, PRIORITIES, '--priority'),
        actorId: o.actor === undefined ? undefined : parseId(o.actor, '--actor'),
        subModuleId: o.subModule === undefined ? undefined : parseId(o.subModule, '--sub-module'),
        channel: o.channel === undefined ? undefined : parseChannels(o.channel, '--channel')[0],
        status: parseEnumList(o.status, STATUSES, '--status'),
        gap: parseEnumList(o.gap, GAP_CODES, '--gap'),
        ...scopeParams(o),
        sort: o.sort === undefined ? undefined : requireOneOf(o.sort.trim().toLowerCase(), SORTS, '--sort'),
        order: o.order === undefined ? undefined : requireOneOf(o.order.trim().toLowerCase(), ORDERS, '--order'),
        pageNum: o.page === undefined ? undefined : parseId(o.page, '--page'),
        pageSize: o.size === undefined ? undefined : parseId(o.size, '--size'),
      };
      const page: UcPage = (await apiClient.get(`/products/${productId}/use-cases`, params)) ?? {};
      emit(o.json, page, () => renderList(page));
    }));

  uc.command('show <uc>').description('Show a use case: channels and entries, linked FPs / tests, relations. <uc> = UC-n (with --product) or id')
    .option(...PRODUCT_OPT).option(...JSON_OPT)
    .action((ref, o) => guarded('获取用例失败', CODES, async () => {
      const detail: UcDetail = await apiClient.get(detailPath(await ucId(ref, o)));
      emit(o.json, detail, () => renderDetail(detail));
    }));

  uc.command('add').description('Create a use case (org owner/admin)')
    .option(...PRODUCT_OPT).requiredOption('--actor <idOrName>', 'Actor id or name (see uc actors list)')
    .requiredOption('--goal <text>', 'User-view goal in one sentence (max 200)').requiredOption('--priority <p>', 'P0|P1|P2')
    .requiredOption('--channel <list>', 'Requested channels, comma separated: WEB,APP,CLI,MCP,API')
    .option('--sub-module <id>', 'Sub-module id').option('--note <text>', 'Note (max 2000)')
    .option('--release <id>', 'Target release id').option('--milestone <id>', 'Target milestone id').option(...JSON_OPT)
    .action((o) => guarded('创建用例失败', CODES, async () => {
      const productId = resolveProductId(o.product);
      const body = buildCreateBody(o, await resolveActorId(o.actor, productId));
      const created: UcDetail = await apiClient.post(`/products/${productId}/use-cases`, body);
      emit(o.json, created, () => done('用例已创建', created));
    }));

  uc.command('update <uc>').description('Change fields of a use case; fields you do not give keep their value (GET, merge, PUT)')
    .option(...PRODUCT_OPT).option('--actor <idOrName>', 'Actor id or name').option('--goal <text>', 'Goal (max 200)')
    .option('--priority <p>', 'P0|P1|P2').option('--sub-module <id>', 'Sub-module id').option('--note <text>', 'Note (max 2000)')
    .option('--release <id>', 'Target release id').option('--milestone <id>', 'Target milestone id')
    .option('--clear <fields>', 'Empty optional fields: sub-module,note,release,milestone').option(...JSON_OPT)
    .action((ref, o) => guarded('更新用例失败', CODES, async () => {
      requireChanges(o);
      const id = await ucId(ref, o);
      const current: UcDetail & { actorId: number; subModuleId?: number | null } = await apiClient.get(detailPath(id));
      const actorId = o.actor === undefined ? undefined : await resolveActorId(o.actor, current.productId as number);
      const updated: UcDetail = await apiClient.put(detailPath(id), mergeUpdateBody(current, o, actorId));
      emit(o.json, updated, () => done('用例已更新', updated));
    }));

  uc.command('delete <uc>').description('Soft-delete a use case; if other use cases include/extend it the server asks for --confirm')
    .option(...PRODUCT_OPT).option('--confirm', 'Delete although other use cases reference it (their relations to it are voided)')
    .action((ref, o) => guarded('删除用例失败', CODES, async () => {
      const id = await ucId(ref, o);
      await apiClient.delete(`${detailPath(id)}?confirm=${o.confirm ? 'true' : 'false'}`);
      console.log(`✓ 用例已删除: ${ref}`);
    }));
}

function registerActorCommands(uc: Command): void {
  const actors = uc.command('actors').description('Use case actors of a product (who uses it; not account roles)');
  const base = (o: { product?: string }) => `/products/${resolveProductId(o.product)}/use-case-actors`;
  actors.command('list').description('List actors, disabled ones included').option(...PRODUCT_OPT).option(...JSON_OPT)
    .action((o) => guarded('获取角色失败', CODES, async () => {
      const rows: Actor[] = (await apiClient.get(base(o))) ?? [];
      emit(o.json, rows, () => renderActors(rows));
    }));
  actors.command('add <name>').description('Add an actor (org owner/admin)').option(...PRODUCT_OPT).option('--disabled', 'Add it disabled').option(...JSON_OPT)
    .action((name, o) => guarded('新增角色失败', CODES, async () => {
      const created: Actor = await apiClient.post(base(o), { name: requireText(name, MAX_ACTOR_NAME, '<name>').trim(), enabled: o.disabled ? false : undefined });
      emit(o.json, created, () => `✓ 角色已新增: #${created.id} ${created.name}`);
    }));
  actors.command('rename <actorId> <name>').description('Rename an actor').option(...PRODUCT_OPT).option(...JSON_OPT)
    .action((actorId, name, o) => guarded('改名失败', CODES, async () => {
      const updated: Actor = await apiClient.put(`${base(o)}/${parseId(actorId, '<actorId>')}`, { name: requireText(name, MAX_ACTOR_NAME, '<name>').trim() });
      emit(o.json, updated, () => `✓ 角色已改名: #${updated.id} ${updated.name}`);
    }));
  for (const [verb, enabled, text] of [['disable', false, '已停用'], ['enable', true, '已启用']] as const) {
    actors.command(`${verb} <actorId>`).description(`${verb === 'disable' ? 'Disable' : 'Enable'} an actor (existing use cases keep it)`).option(...PRODUCT_OPT).option(...JSON_OPT)
      .action((actorId, o) => guarded('更新角色失败', CODES, async () => {
        const updated: Actor = await apiClient.put(`${base(o)}/${parseId(actorId, '<actorId>')}`, { enabled });
        emit(o.json, updated, () => `✓ 角色${text}: #${updated.id} ${updated.name}`);
      }));
  }
  actors.command('delete <actorId>').description('Delete an actor not used by any use case (otherwise disable it)').option(...PRODUCT_OPT)
    .action((actorId, o) => guarded('删除角色失败', CODES, async () => {
      await apiClient.delete(`${base(o)}/${parseId(actorId, '<actorId>')}`);
      console.log(`✓ 角色已删除: #${actorId}`);
    }));
}

function registerLinkCommands(uc: Command): void {
  const mutate = (name: string, args: string, description: string, fail: string, run: (id: number, a: string[], o: any) => Promise<UcDetail>, what: string, extra?: (c: Command) => Command) => {
    const cmd = uc.command(`${name} ${args}`).description(description).option(...PRODUCT_OPT).option(...JSON_OPT);
    (extra ? extra(cmd) : cmd).action((...all: any[]) => guarded(fail, CODES, async () => {
      const o = all[all.length - 2];
      const positional: string[] = all.slice(0, all.length - 2);
      const result = await run(await ucId(positional[0], o), positional.slice(1), o);
      emit(o.json, result, () => done(what, result));
    }));
  };
  mutate('link-fp', '<uc> <fp>', 'Link a function point (id or code like fun-org-0001) to a use case', '关联 FP 失败',
    async (id, [fp]) => apiClient.post(`${detailPath(id)}/functions`, { functionPointId: await resolveFunctionPointId(fp, id) }), '已关联 FP');
  mutate('unlink-fp', '<uc> <fp>', 'Remove an FP link (an FP that carries an entry declaration must lose the entry first)', '取消关联 FP 失败',
    async (id, [fp]) => apiClient.delete(`${detailPath(id)}/functions/${await resolveFunctionPointId(fp, id)}`), '已取消关联 FP');
  mutate('link-test', '<uc> <testCase>', 'Link a test case (id or case no.) to a use case', '关联测试用例失败',
    async (id, [t]) => apiClient.post(`${detailPath(id)}/test-cases`, { testCaseId: await resolveTestCaseId(t, id) }), '已关联测试用例');
  mutate('unlink-test', '<uc> <testCase>', 'Remove a test case link', '取消关联测试用例失败',
    async (id, [t]) => apiClient.delete(`${detailPath(id)}/test-cases/${await resolveTestCaseId(t, id)}`), '已取消关联测试用例');

  const entry = uc.command('entry').description('Entry declarations: where a channel exposes the use case');
  entry.command('add <uc>').description('Declare an entry: --channel, --ref (screen/route, command, tool name, method+path), --fp (must be linked already)')
    .option(...PRODUCT_OPT).requiredOption('--channel <c>', 'WEB|APP|CLI|MCP|API (one of the use case\'s requested channels)')
    .requiredOption('--ref <text>', 'Entry reference (max 200)').requiredOption('--fp <fp>', 'Carrying FP: id or code').option(...JSON_OPT)
    .action((ref, o) => guarded('登记入口失败', CODES, async () => {
      const id = await ucId(ref, o);
      const body = buildEntryBody(o, await resolveFunctionPointId(String(o.fp), id));
      const result: UcDetail = await apiClient.post(`${detailPath(id)}/entries`, body);
      emit(o.json, result, () => done('入口已登记', result));
    }));
  entry.command('remove <uc> <entryId>').description('Delete an entry declaration').option(...PRODUCT_OPT).option(...JSON_OPT)
    .action((ref, entryId, o) => guarded('删除入口失败', CODES, async () => {
      const result: UcDetail = await apiClient.delete(`${detailPath(await ucId(ref, o))}/entries/${parseId(entryId, '<entryId>')}`);
      emit(o.json, result, () => done('入口已删除', result));
    }));

  uc.command('channels').description('Requested channels').command('set <uc> <channels>')
    .description('Replace the requested channels (comma separated). Dropping a channel voids its entry declarations')
    .option(...PRODUCT_OPT).option(...JSON_OPT)
    .action((ref, channels, o) => guarded('设置渠道失败', CODES, async () => {
      const result: UcDetail = await apiClient.put(`${detailPath(await ucId(ref, o))}/channels`, { channels: parseChannels(channels, '<channels>') });
      emit(o.json, result, () => done(`渠道已设置为 ${(result.channels ?? []).join(',')}`, result));
    }));

  const relation = uc.command('relation').description('include / extend relations between use cases');
  relation.command('add <uc>').description('<uc> include|extend --target: <uc> is the subject (UC-1 include UC-2; UC-4 extend UC-1 --when "...")')
    .option(...PRODUCT_OPT).requiredOption('--type <t>', 'include|extend').requiredOption('--target <uc>', 'The other use case (UC-n or id)')
    .option('--when <text>', 'Trigger condition (required for extend, not allowed for include; max 200)').option(...JSON_OPT)
    .action((ref, o) => guarded('建立关系失败', CODES, async () => {
      const id = await ucId(ref, o);
      const body = buildRelationBody(o, await ucId(o.target, o));
      const result: UcDetail = await apiClient.post(`${detailPath(id)}/relations`, body);
      emit(o.json, result, () => done('关系已建立', result));
    }));
  relation.command('remove <uc> <relationId>').description('Delete a relation (from either end)').option(...PRODUCT_OPT).option(...JSON_OPT)
    .action((ref, relationId, o) => guarded('删除关系失败', CODES, async () => {
      const result: UcDetail = await apiClient.delete(`${detailPath(await ucId(ref, o))}/relations/${parseId(relationId, '<relationId>')}`);
      emit(o.json, result, () => done('关系已删除', result));
    }));

  const candidates = uc.command('candidates').description('Search things that can be linked');
  const search = (kind: 'functions' | 'test-cases', description: string, render: (rows: any[]) => string) =>
    candidates.command(`${kind === 'functions' ? 'fp' : 'test'} [keyword]`).description(description)
      .option(...PRODUCT_OPT).option('--limit <n>', '1-50, default 20').option(...JSON_OPT)
      .action((keyword, o) => guarded('搜索候选失败', CODES, async () => {
        const rows = (await apiClient.get(`/products/${resolveProductId(o.product)}/use-case-candidates/${kind}`, { keyword, limit: parseLimit(o.limit) })) ?? [];
        emit(o.json, rows, () => render(rows));
      }));
  search('functions', 'Search FPs by code or name (cancelled / removed ones are listed too, marked invalid)', renderFpCandidates);
  search('test-cases', 'Search test cases by case no. or title, with their latest result', renderTestCandidates);
}

function registerDiagramCommands(uc: Command): void {
  uc.command('diagrams <uc>').description('Flow diagrams of a use case with their freshness (最新 / 图已过期 / 未渲染)')
    .option(...PRODUCT_OPT).option(...JSON_OPT)
    .action((ref, o) => guarded('获取流程图失败', CODES, async () => {
      const rows: DiagramRow[] = (await apiClient.get(`${detailPath(await ucId(ref, o))}/diagrams`)) ?? [];
      emit(o.json, rows, () => renderDiagrams(rows));
    }));

  uc.command('overviews').description('Overview diagrams (P0 overview, one per sub-module, unassigned) with their freshness')
    .option(...PRODUCT_OPT).option(...JSON_OPT)
    .action((o) => guarded('获取总图失败', CODES, async () => {
      const rows: OverviewRow[] = (await apiClient.get(`/products/${resolveProductId(o.product)}/use-case-diagrams`)) ?? [];
      // the generated source can be long; the listing shows state, --json carries it
      emit(o.json, rows, () => renderOverviews(rows));
    }));

  uc.command('push <uc> <file>')
    .description('Render a PlantUML file on this machine (SANDBOX) and, only if that works, save it as a flow diagram of <uc> with its PNG')
    .option(...PRODUCT_OPT).option('--name <name>', 'Diagram name, unique per use case (default: file name without extension)')
    .requiredOption('--type <t>', 'SEQUENCE|ACTIVITY').option(...JSON_OPT)
    .action(async (ref, file, o) => {
      let renderFailure: string | undefined;
      await guarded('推送流程图失败', CODES, async () => {
        const type = upper(o.type, DIAGRAM_TYPES, '--type');
        const name = requireText(o.name ?? path.basename(file, path.extname(file)), MAX_DIAGRAM_NAME, '--name').trim();
        const source = readSourceFile(file);
        try {
          const { diagram, warning } = await pushDiagram(createRenderer(), source, { name, type }, () => ucId(ref, o));
          if (warning) console.error(`⚠ ${warning}`);
          emit(o.json, diagram, () => `✓ 流程图「${diagram.name}」已保存: v${diagram.currentVersionNo}，${diagram.freshness?.label ?? ''}（渲染 #${diagram.latestRender?.id ?? '?'}，PlantUML ${diagram.latestRender?.plantumlVersion ?? '?'}）`);
        } catch (e) {
          if (!(e instanceof RenderError)) throw e;
          renderFailure = describeRenderError(e);
        }
      });
      if (renderFailure !== undefined) {
        console.error(`✗ 本机渲染失败，没有提交任何内容:\n${renderFailure}`);
        process.exit(1);
      }
    });

  uc.command('render')
    .description('Render on this machine (SANDBOX) and upload every stale or unrendered picture: flow diagrams and overviews; each picture succeeds or fails on its own')
    .option(...PRODUCT_OPT).option('--overview <key>', 'Only overviews: a key (p0-overview, unassigned, sub-<id>... as in uc overviews) or "all"')
    .option('--diagrams', 'Only flow diagrams').option('--uc <uc>', 'Only the flow diagrams of this use case')
    .option('--all', 'Also re-render pictures that are already up to date').option(...JSON_OPT)
    .action(async (o) => {
      let failed = false;
      await guarded('渲染失败', CODES, async () => {
        const productId = resolveProductId(o.product);
        const useCase = o.uc === undefined ? undefined : { id: await ucId(o.uc, o), code: /^uc-/i.test(o.uc) ? o.uc.toUpperCase() : `UC#${o.uc}` };
        const plan = await planRender({ productId, overview: o.overview, diagrams: o.diagrams, useCase, all: o.all });
        if (!plan.targets.length && !plan.failures.length) {
          console.log(`没有需要渲染的图${plan.skipped ? `（${plan.skipped} 张已是最新；加 --all 强制重渲染）` : ''}`);
          return;
        }
        const renderer = createRenderer();
        if (plan.targets.length) await renderer.ready(); // a machine that cannot render is refused once, before anything starts
        const items = await runPlan(plan, renderer);
        emit(o.json, { items, skipped: plan.skipped }, () => renderBatch(items, plan.skipped));
        failed = items.some((i) => !i.ok);
      });
      if (failed) process.exit(1);
    });
}

function registerImportCommand(uc: Command): void {
  uc.command('import <paths...>')
    .description('Import the roles and use cases of existing PlantUML use case diagrams (.puml; directories are searched recursively). Preview by default, --apply writes')
    .option(...PRODUCT_OPT).option('--priority <p>', 'P0|P1|P2 (required: not guessed)').option('--channels <list>', 'Requested channels, comma separated: WEB,APP,CLI,MCP,API (required: not guessed)')
    .option('--submodule <id>', 'Sub-module id for every imported use case (default: unassigned)')
    .addOption(new Option('--sub-module <id>').hideHelp())
    .option('--apply', 'Write the use cases (default: preview only)').option('--verbose', 'List every use case and relation').option(...JSON_OPT)
    .action(async (paths: string[], o) => {
      let failed = false;
      await guarded('导入用例失败', CODES, async () => {
        failed = await runImport(paths, { ...o, submodule: o.submodule ?? o.subModule }, CODES);
      });
      if (failed) process.exit(1);
    });
}

function registerStatusCommands(uc: Command): void {
  uc.command('status <uc>').description('Derived status of a use case: per-channel reachability and why, gap marks, what verification lacks, status of included use cases')
    .option(...PRODUCT_OPT).option(...JSON_OPT)
    .action((ref, o) => guarded('获取用例状态失败', CODES, async () => {
      const view: StatusView = await apiClient.get(`${detailPath(await ucId(ref, o))}/status`);
      emit(o.json, view, () => renderStatus(view));
    }));

  const scoped = (c: Command) => c.option(...PRODUCT_OPT).option('--release <id>', 'Only use cases targeting this release')
    .option('--milestone <id>', 'Only use cases targeting this milestone (with --release: both)').option(...JSON_OPT);

  scoped(uc.command('metrics').description('Completion figures: P0 first, then P1 / P2 / total; usable and verified rates, count per status (live, no history; reference only)'))
    .action((o) => guarded('获取完成度指标失败', CODES, async () => {
      const metrics: Metrics = await apiClient.get(`/products/${resolveProductId(o.product)}/use-case-metrics`, scopeParams(o));
      emit(o.json, metrics, () => renderMetrics(metrics));
    }));

  scoped(uc.command('gaps').description('P0 use cases that are partial or not started, with their gap marks'))
    .action((o) => guarded('获取缺口清单失败', CODES, async () => {
      const rows: UcListItem[] = (await apiClient.get(`/products/${resolveProductId(o.product)}/use-case-gaps`, scopeParams(o))) ?? [];
      emit(o.json, rows, () => renderGaps(rows));
    }));
}

export function registerUcCommands(program: Command) {
  const uc = program.command('uc').description('User use cases: register, link FPs / tests / entries / relations, push and render PlantUML diagrams');
  // the server records the source of a change (activity feed, object-file access log) from this header
  uc.hook('preAction', () => apiClient.setDefaultHeader('X-Client-Channel', 'cli'));
  registerUseCaseCommands(uc);
  registerActorCommands(uc);
  registerLinkCommands(uc);
  registerStatusCommands(uc);
  registerDiagramCommands(uc);
  registerImportCommand(uc);
}

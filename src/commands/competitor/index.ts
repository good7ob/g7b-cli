/**
 * `good7ob competitor` — product competitor analysis (prd-0183, api-0183): competitors, the matrix rows (capabilities),
 * the cells that compare them, sources, opportunities / gaps and turning them into ideas. `ai-fill` lets a person
 * have the "本产品" column filled by AI; AI employees and MCP cannot trigger it (rp-compete-0074).
 *
 * Every change PUTs a full body with the `version` it read (optimistic lock): the command reads first, merges what you
 * gave and writes back; if someone else changed the object meanwhile the server answers 15108 and you run it again.
 */
import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import {
  AI_REQUEST_CONFIG, ErrorCodeMap, InputError, checkMaxLength, emit, guarded, parseId, requireText, withTimeoutHint,
} from '../../utils/cliHelpers';
import {
  CELL_VALUES, CLEARABLE_OPPORTUNITY, CONVERT_MODES, KINDS, MAX_CAPABILITY_NOTE, MAX_DESCRIPTION, MAX_NAME, MAX_NOTE, MAX_TITLE,
  OPP_STATUS_FILTER, THREATS, buildCapabilityItems, buildCompetitorCreate, buildSourceFields, capabilitiesPath, capabilityId,
  checkOpportunityFlags, competitorId, competitorIds, competitorsPath, hasCompetitorChange, hasOpportunityChange, matrixPath,
  mergeCompetitorUpdate, opportunitiesPath, parseClear, productOf, rejectClearConflict, resolveByIdOrName, sourcesPath, upper,
} from './input';
import {
  AiFillResult, CapabilityRow, CellRow, CompetitorRow, ConvertResult, Matrix, OpportunityRow, SourceRow, renderAdded, renderAiFill,
  renderCapabilities, renderCell, renderCompetitor, renderCompetitors, renderConvert, renderMatrix, renderOpportunities, renderSources,
} from './render';

export const CODES: ErrorCodeMap = {
  1000: '缺少必填参数',
  1001: '参数不合法',
  1002: '竞品 / 能力项 / 来源 / 机会点不存在，或不属于这个产品',
  2000: '暂无权限（查看需是产品所属组织成员，编辑需是组织 owner/admin；AI 员工 Key 需在 AI 员工编辑中开启「允许访问竞品分析模块」，转为想法另需「想法」能力；AI 填写只能由用户本人触发）',
  4015: '余额不足，AI 填写没有执行，也没有扣费',
  15101: '这个产品里已有同名竞品',
  15102: '竞品数量已达上限 10',
  15103: '链接只接受 http:// 或 https://',
  15104: '该对象或名称已经是矩阵里的一行',
  15105: '能力项数量已达上限 100',
  15106: '这个对象的来源已达 5 条，先删掉一条',
  15107: '核实日期不得晚于今天',
  15108: '已被他人修改，或这一格当前状态与你读到的不一致。没有写入任何内容，请重新执行命令（会重新读取最新内容）',
  15109: '机会点数量已达上限 200',
  15110: '已转为想法的机会点不能手动改状态',
  15111: '标题或说明超出想法字段的长度，请缩短后重试',
  15112: '要关联的想法不存在，或不属于这个产品',
  15113: '只有「待处理」的机会点可以转为想法',
  15114: '关联的需求树节点或用例不属于这个产品',
  15115: 'AI 填写还没有开通（计费项尚未登记，服务端随 g7b #2602 上线）。现在请用 competitor cell set 手工填写',
};

const JSON_OPT = ['--json', 'Output as JSON'] as const;
const PRODUCT_OPT = ['--product <id>', '产品 ID（或环境变量 GOOD7OB_PRODUCT_ID）'] as const;
type Opts = Record<string, any>;

const done = (what: string, name: string) => `✓ ${what}: ${name}`;

async function readMatrix(productId: number): Promise<Matrix> {
  const m: Matrix = (await apiClient.get(matrixPath(productId))) ?? { competitors: [], capabilities: [], cells: [] };
  return { ...m, competitors: m.competitors ?? [], capabilities: m.capabilities ?? [], cells: m.cells ?? [] };
}

const findCell = (m: Matrix, capability: number, competitor: number | null): CellRow | undefined =>
  m.cells.find((c) => c.capabilityId === capability && (c.competitorId ?? null) === competitor);

/** The cell's two coordinates from the matrix: a capability (id or name) and a competitor (id or name), none = our own column. */
async function cellTarget(m: Matrix, o: Opts, ref: string): Promise<{ capability: number; competitor: number | null }> {
  const capability = await resolveByIdOrName(ref, '能力项', async () => m.capabilities);
  const competitor = o.competitor === undefined ? null : await resolveByIdOrName(o.competitor, '竞品', async () => m.competitors);
  return { capability, competitor };
}

function registerCrudCommands(root: Command): void {
  root.command('list').description('List competitors (highest threat first) with their source credibility')
    .option(...PRODUCT_OPT).option(...JSON_OPT)
    .action((o) => guarded('获取竞品列表失败', CODES, async () => {
      const rows: CompetitorRow[] = (await apiClient.get(competitorsPath(productOf(o)))) ?? [];
      emit(o.json, rows, () => renderCompetitors(rows));
    }));

  root.command('show <competitor>').alias('get').description('Show one competitor. <competitor> = id or name')
    .option(...PRODUCT_OPT).option(...JSON_OPT)
    .action((ref, o) => guarded('获取竞品失败', CODES, async () => {
      const productId = productOf(o);
      const id = await competitorId(ref, productId);
      const rows: CompetitorRow[] = (await apiClient.get(competitorsPath(productId))) ?? [];
      const row = rows.find((c) => c.id === id);
      if (!row) throw new InputError(`产品 ${productId} 里没有竞品 ${ref}`);
      emit(o.json, row, () => renderCompetitor(row));
    }));

  const fields = (c: Command) => c.option('--positioning <text>', `One-line positioning (max 200)`).option('--target-users <text>', 'Target users (max 200)')
    .option('--pricing <text>', 'Pricing / charging model (max 500)').option('--website <url>', 'Website, http(s) only')
    .option('--threat <level>', THREATS.join('|')).option('--note <text>', `Note (max ${MAX_NOTE})`);

  fields(root.command('add').alias('create').description('Add a competitor (org owner/admin; at most 10 per product)')
    .option(...PRODUCT_OPT).requiredOption('--name <name>', `Name, unique in the product (max ${MAX_NAME})`)).option(...JSON_OPT)
    .action((o) => guarded('创建竞品失败', CODES, async () => {
      const created: CompetitorRow = await apiClient.post(competitorsPath(productOf(o)), buildCompetitorCreate(o));
      emit(o.json, created, () => done('竞品已创建', `#${created.id} ${created.name}`));
    }));

  fields(root.command('update <competitor>').description('Change a competitor; fields you do not give keep their value (GET, merge, PUT with the version read)')
    .option(...PRODUCT_OPT).option('--name <name>', 'New name'))
    .option('--clear <fields>', 'Empty optional fields: positioning,target-users,pricing,website,note').option(...JSON_OPT)
    .action((ref, o) => guarded('更新竞品失败', CODES, async () => {
      if (!hasCompetitorChange(o)) throw new InputError('没有要修改的内容：至少给一个 --name / --positioning / --target-users / --pricing / --website / --threat / --note / --clear');
      const productId = productOf(o);
      const id = await competitorId(ref, productId);
      const current = ((await apiClient.get(competitorsPath(productId))) ?? []).find((c: CompetitorRow) => c.id === id);
      if (!current) throw new InputError(`产品 ${productId} 里没有竞品 ${ref}`);
      const updated: CompetitorRow = await apiClient.put(`${competitorsPath(productId)}/${id}`, mergeCompetitorUpdate(current, o));
      emit(o.json, updated, () => done('竞品已更新', `#${updated.id} ${updated.name}（v${updated.version}）`));
    }));

  root.command('delete <competitor>').description('Soft-delete a competitor; its cells and sources are hidden, opportunities that mention it stay')
    .option(...PRODUCT_OPT)
    .action((ref, o) => guarded('删除竞品失败', CODES, async () => {
      const productId = productOf(o);
      await apiClient.delete(`${competitorsPath(productId)}/${await competitorId(ref, productId)}`);
      console.log(`✓ 竞品已删除: ${ref}`);
    }));
}

function registerCapabilityCommands(root: Command): void {
  const cap = root.command('capability').description('Matrix rows: what is compared (requirement-tree FE / FP, use cases, or free text)');
  cap.command('list').description('List matrix rows with the current name of the object they point at').option(...PRODUCT_OPT).option(...JSON_OPT)
    .action((o) => guarded('获取能力项失败', CODES, async () => {
      const rows: CapabilityRow[] = (await apiClient.get(capabilitiesPath(productOf(o)))) ?? [];
      emit(o.json, rows, () => renderCapabilities(rows));
    }));

  cap.command('add').description('Add rows (org owner/admin; at most 100 per product); ones already in the matrix are skipped')
    .option(...PRODUCT_OPT).option('--fe <list>', 'Requirement-tree FE: ids or codes, comma separated')
    .option('--fp <list>', 'Requirement-tree FP: ids or codes (fun-org-0001), comma separated')
    .option('--use-case <list>', 'Use cases: UC-n or ids, comma separated')
    .option('--name <text>', 'A free-text row; repeat for several', (v: string, prev: string[] = []) => [...prev, v])
    .option('--note <text>', `Note for every added row (max ${MAX_CAPABILITY_NOTE})`).option(...JSON_OPT)
    .action((o) => guarded('添加能力项失败', CODES, async () => {
      const productId = productOf(o);
      const result = await apiClient.post(capabilitiesPath(productId), { items: await buildCapabilityItems(o, productId) });
      emit(o.json, result, () => renderAdded(result ?? {}));
    }));

  cap.command('update <capability>').description('Rename a free-text row and / or change its note (a row that points at an object only takes a note). <capability> = id or name')
    .option(...PRODUCT_OPT).option('--name <name>', 'New name').option('--note <text>', 'New note').option('--clear-note', 'Empty the note').option(...JSON_OPT)
    .action((ref, o) => guarded('更新能力项失败', CODES, async () => {
      if (o.name === undefined && o.note === undefined && !o.clearNote) throw new InputError('没有要修改的内容：给 --name、--note 或 --clear-note');
      if (o.note !== undefined && o.clearNote) throw new InputError('--note 与 --clear-note 不能同时使用');
      if (o.name !== undefined) requireText(o.name, MAX_NAME, '--name');
      if (o.note !== undefined) checkMaxLength(o.note, MAX_CAPABILITY_NOTE, '--note');
      const productId = productOf(o);
      const rows: CapabilityRow[] = (await apiClient.get(capabilitiesPath(productId))) ?? [];
      const id = await resolveByIdOrName(ref, '能力项', async () => rows);
      const current = rows.find((r) => r.id === id);
      if (!current) throw new InputError(`产品 ${productId} 里没有能力项 ${ref}`);
      // PUT replaces the note (null clears it), so the note you did not mention is sent back as it is
      const note = o.clearNote ? null : o.note !== undefined ? o.note.trim() : current.note ?? null;
      const updated: CapabilityRow = await apiClient.put(`${capabilitiesPath(productId)}/${id}`, { name: o.name?.trim(), note });
      emit(o.json, updated, () => done('能力项已更新', `#${updated.id} ${updated.name}`));
    }));

  cap.command('delete <capability>').description('Soft-delete a row; its cells and sources are hidden with it').option(...PRODUCT_OPT)
    .action((ref, o) => guarded('删除能力项失败', CODES, async () => {
      const productId = productOf(o);
      await apiClient.delete(`${capabilitiesPath(productId)}/${await capabilityId(ref, productId)}`);
      console.log(`✓ 能力项已删除: ${ref}`);
    }));
}

function registerMatrixCommands(root: Command): void {
  root.command('matrix').description('The comparison matrix: our product and each competitor against every row (? unknown, * no source or stale, (AI) waiting for confirmation)')
    .option(...PRODUCT_OPT).option(...JSON_OPT)
    .action((o) => guarded('获取对比矩阵失败', CODES, async () => {
      const m = await readMatrix(productOf(o));
      emit(o.json, m, () => renderMatrix(m));
    }));

  const cell = root.command('cell').description('Cells of the matrix. Leave --competitor out for our own product column');
  cell.command('set <capability>').description('Write a cell: value and note (a person\'s write is final for the AI). <capability> = id or name')
    .option(...PRODUCT_OPT).option('--competitor <competitor>', 'Competitor id or name (default: our own product)')
    .requiredOption('--value <v>', CELL_VALUES.join('|')).option('--note <text>', 'Note').option('--clear-note', 'Empty the note').option(...JSON_OPT)
    .action((ref, o) => guarded('写入对比格失败', CODES, async () => {
      const value = upper(o.value, CELL_VALUES, '--value');
      if (o.note !== undefined && o.clearNote) throw new InputError('--note 与 --clear-note 不能同时使用');
      const productId = productOf(o);
      const m = await readMatrix(productId);
      const { capability, competitor } = await cellTarget(m, o, ref);
      const current = findCell(m, capability, competitor);
      // the cell is replaced as a whole: a note you did not mention stays; no record yet means no version (creates it)
      const note = o.clearNote ? null : o.note !== undefined ? o.note.trim() : current?.note ?? null;
      const saved: CellRow = await apiClient.put(`${matrixPath(productId)}/cells`,
        { capabilityId: capability, competitorId: competitor, value, note, version: current?.version });
      emit(o.json, saved, () => `✓ 已写入: ${renderCell(saved)}`);
    }));

  cell.command('confirm <capability>').description('Confirm a cell the AI filled: value and note stay, it now counts as a person\'s')
    .option(...PRODUCT_OPT).option('--competitor <competitor>', 'Competitor id or name (default: our own product)').option(...JSON_OPT)
    .action((ref, o) => guarded('确认对比格失败', CODES, async () => {
      const productId = productOf(o);
      const m = await readMatrix(productId);
      const { capability, competitor } = await cellTarget(m, o, ref);
      const current = findCell(m, capability, competitor);
      if (!current) throw new InputError('这一格还没有记录，没有可确认的 AI 填写');
      if (current.fillMode !== 'AI' || current.humanTouched) throw new InputError('这一格不是待确认的 AI 填写（已由人工写入或已确认）');
      const saved: CellRow = await apiClient.post(`${matrixPath(productId)}/cells/confirm`,
        { capabilityId: capability, competitorId: competitor, version: current.version });
      emit(o.json, saved, () => `✓ 已确认: ${renderCell(saved)}`);
    }));
}

/** Where a source hangs: `--capability` makes it a cell's (with `--competitor`, that competitor's cell; without, ours), `--competitor` alone the competitor's. */
function sourceTarget(o: Opts): 'COMPETITOR' | 'CELL' {
  if (o.capability === undefined && o.competitor === undefined) throw new InputError('要给来源指定挂在哪：--competitor <竞品>（竞品的来源）或 --capability <能力项> [--competitor <竞品>]（某一格的来源）');
  return o.capability === undefined ? 'COMPETITOR' : 'CELL';
}

const TARGET_OPTS = (c: Command) => c.option('--competitor <competitor>', 'Competitor id or name').option('--capability <capability>', 'Matrix row id or name (with --competitor: that competitor\'s cell, alone: our own cell)');

async function listSources(productId: number, o: Opts): Promise<SourceRow[]> {
  const targetType = sourceTarget(o);
  return (await apiClient.get(sourcesPath(productId), {
    targetType,
    competitorId: o.competitor === undefined ? undefined : await competitorId(o.competitor, productId),
    capabilityId: o.capability === undefined ? undefined : await capabilityId(o.capability, productId),
  })) ?? [];
}

/** A source is found by id among the cells' sources of the matrix, then among each competitor's own (S01). */
async function findSource(productId: number, id: number): Promise<SourceRow | undefined> {
  const m = await readMatrix(productId);
  const inCell = m.cells.flatMap((c) => c.sources ?? []).find((s) => s.id === id);
  if (inCell) return inCell;
  for (const c of m.competitors) {
    const rows: SourceRow[] = (await apiClient.get(sourcesPath(productId), { targetType: 'COMPETITOR', competitorId: c.id })) ?? [];
    const hit = rows.find((s) => s.id === id);
    if (hit) return hit;
  }
  return undefined;
}

function registerSourceCommands(root: Command): void {
  const source = root.command('source').description('Where a fact comes from: a link, how reliable it is, when it was checked (at most 5 per object)');
  const fields = (c: Command) => c.option('--url <url>', 'Link, http(s) only').option('--credibility <c>', 'PRIMARY|SECONDARY|UNVERIFIED')
    .option('--verified-on <date>', 'Day checked, yyyy-MM-dd (default: today, JST; not after today)');

  TARGET_OPTS(source.command('list').description('Sources of a competitor, or of a cell').option(...PRODUCT_OPT)).option(...JSON_OPT)
    .action((o) => guarded('获取来源失败', CODES, async () => {
      const rows = await listSources(productOf(o), o);
      emit(o.json, rows, () => renderSources(rows));
    }));

  fields(TARGET_OPTS(source.command('add').description('Add a source to a competitor or to a cell (the cell is created when it has no record)')
    .option(...PRODUCT_OPT).requiredOption('--title <text>', 'What the source is (max 200)'))).option(...JSON_OPT)
    .action((o) => guarded('新增来源失败', CODES, async () => {
      const productId = productOf(o);
      const targetType = sourceTarget(o);
      const result = await apiClient.post(sourcesPath(productId), {
        targetType, ...buildSourceFields(o),
        competitorId: o.competitor === undefined ? undefined : await competitorId(o.competitor, productId),
        capabilityId: o.capability === undefined ? undefined : await capabilityId(o.capability, productId),
      });
      emit(o.json, result, () => done('来源已新增', `#${result.source.id} ${result.source.title}`));
    }));

  fields(source.command('update <sourceId>').description('Change a source; fields you do not give keep their value (found by id, PUT with the version read)')
    .option(...PRODUCT_OPT).option('--title <text>', 'What the source is (max 200)')).option(...JSON_OPT)
    .action((sourceId, o) => guarded('更新来源失败', CODES, async () => {
      const id = parseId(sourceId, '<sourceId>');
      if (o.title === undefined && o.url === undefined && o.credibility === undefined && o.verifiedOn === undefined) throw new InputError('没有要修改的内容：给 --title / --url / --credibility / --verified-on');
      const productId = productOf(o);
      const current = await findSource(productId, id);
      if (!current) throw new InputError(`产品 ${productId} 里没有来源 #${id}`);
      const result = await apiClient.put(`${sourcesPath(productId)}/${id}`, { ...buildSourceFields(o, current), version: current.version });
      emit(o.json, result, () => done('来源已更新', `#${result.source.id} ${result.source.title}（v${result.source.version}）`));
    }));

  source.command('delete <sourceId>').description('Soft-delete a source; the object\'s credibility and flags follow').option(...PRODUCT_OPT)
    .action((sourceId, o) => guarded('删除来源失败', CODES, async () => {
      await apiClient.delete(`${sourcesPath(productOf(o))}/${parseId(sourceId, '<sourceId>')}`);
      console.log(`✓ 来源已删除: #${sourceId}`);
    }));
}

const OPP_REFS = (c: Command) => c.option('--capability <capability>', 'Related matrix row: id or name')
  .option('--competitor <list>', 'Related competitors: ids or names, comma separated').option('--description <text>', `Description (max ${MAX_DESCRIPTION})`);

function registerOpportunityCommands(root: Command): void {
  const opp = root.command('opportunity').description('Opportunities and gaps found by comparing; turn them into ideas');
  opp.command('list').description('List opportunities and gaps, with related competitors, row and the idea they became')
    .option(...PRODUCT_OPT).option('--kind <k>', KINDS.join('|')).option('--status <s>', OPP_STATUS_FILTER.join('|')).option(...JSON_OPT)
    .action((o) => guarded('获取机会点失败', CODES, async () => {
      const rows: OpportunityRow[] = (await apiClient.get(opportunitiesPath(productOf(o)), {
        kind: o.kind === undefined ? undefined : upper(o.kind, KINDS, '--kind'),
        status: o.status === undefined ? undefined : upper(o.status, OPP_STATUS_FILTER, '--status'),
      })) ?? [];
      emit(o.json, rows, () => renderOpportunities(rows));
    }));

  OPP_REFS(opp.command('create').alias('add').description('Add an opportunity or a gap by hand (at most 200 per product)')
    .option(...PRODUCT_OPT).requiredOption('--kind <k>', KINDS.join('|')).requiredOption('--title <text>', `Title (max ${MAX_TITLE})`)).option(...JSON_OPT)
    .action((o) => guarded('创建机会点失败', CODES, async () => {
      checkOpportunityFlags(o);
      const productId = productOf(o);
      const created: OpportunityRow = await apiClient.post(opportunitiesPath(productId), {
        kind: upper(o.kind, KINDS, '--kind'), title: o.title.trim(), description: o.description?.trim(),
        capabilityId: o.capability === undefined ? undefined : await capabilityId(o.capability, productId),
        competitorIds: o.competitor === undefined ? undefined : await competitorIds(o.competitor, productId),
      });
      emit(o.json, created, () => done('机会点已创建', `#${created.id} ${created.title}`));
    }));

  OPP_REFS(opp.command('update <opportunityId>').description('Change an opportunity; what you do not give keeps its value (GET, merge, PUT with the version read). Status only PENDING <-> IGNORED')
    .option(...PRODUCT_OPT).option('--kind <k>', KINDS.join('|')).option('--title <text>', 'Title').option('--status <s>', 'PENDING|IGNORED'))
    .option('--clear <fields>', `Empty: ${CLEARABLE_OPPORTUNITY.join(',')}`).option(...JSON_OPT)
    .action((opportunityId, o) => guarded('更新机会点失败', CODES, async () => {
      if (!hasOpportunityChange(o)) throw new InputError('没有要修改的内容：至少给一个 --kind / --title / --description / --capability / --competitor / --status / --clear');
      checkOpportunityFlags(o);
      const clear = parseClear(o.clear, CLEARABLE_OPPORTUNITY);
      rejectClearConflict(o, clear, { description: 'description', capability: 'capability', competitors: 'competitor' });
      const id = parseId(opportunityId, '<opportunityId>');
      const productId = productOf(o);
      const rows: OpportunityRow[] = (await apiClient.get(opportunitiesPath(productId))) ?? [];
      const current = rows.find((r) => r.id === id);
      if (!current) throw new InputError(`产品 ${productId} 里没有机会点 #${id}`);
      const body = {
        kind: o.kind === undefined ? current.kind : upper(o.kind, KINDS, '--kind'),
        title: o.title === undefined ? current.title : o.title.trim(),
        description: clear.has('description') ? null : o.description !== undefined ? o.description.trim() : current.description ?? null,
        capabilityId: clear.has('capability') ? null : o.capability !== undefined ? await capabilityId(o.capability, productId) : current.capability?.id ?? null,
        competitorIds: clear.has('competitors') ? [] : o.competitor !== undefined ? await competitorIds(o.competitor, productId) : (current.competitors ?? []).map((c) => c.id),
        status: o.status === undefined ? undefined : upper(o.status, ['PENDING', 'IGNORED'] as const, '--status'),
        version: current.version,
      };
      const updated: OpportunityRow = await apiClient.put(`${opportunitiesPath(productId)}/${id}`, body);
      emit(o.json, updated, () => done('机会点已更新', `#${updated.id} ${updated.title}（v${updated.version}）`));
    }));

  opp.command('delete <opportunityId>').description('Soft-delete an opportunity (an idea already created from it is not touched)').option(...PRODUCT_OPT)
    .action((opportunityId, o) => guarded('删除机会点失败', CODES, async () => {
      await apiClient.delete(`${opportunitiesPath(productOf(o))}/${parseId(opportunityId, '<opportunityId>')}`);
      console.log(`✓ 机会点已删除: #${opportunityId}`);
    }));

  opp.command('generate').description('Generate gap / opportunity candidates from the matrix with fixed templates (no AI, no charge); existing ones are not duplicated')
    .option(...PRODUCT_OPT).option(...JSON_OPT)
    .action((o) => guarded('从矩阵生成失败', CODES, async () => {
      const result = await apiClient.post(`${opportunitiesPath(productOf(o))}/generate`);
      emit(o.json, result, () => `✓ 新增 ${result?.created ?? 0} 条，跳过 ${result?.skipped ?? 0} 条（已存在）${result?.items?.length ? `\n${renderOpportunities(result.items)}` : ''}`);
    }));

  opp.command('convert <opportunityId>').description('Turn a pending opportunity into an idea. --mode check (default) only looks for similar ideas; create makes the idea; link attaches an existing one')
    .option(...PRODUCT_OPT).option('--mode <m>', 'check|create|link (default check)').option('--idea <id>', 'Idea id to link (with --mode link)').option(...JSON_OPT)
    .action((opportunityId, o) => guarded('转为想法失败', CODES, async () => {
      const mode = o.mode === undefined ? 'CHECK' : upper(o.mode, CONVERT_MODES, '--mode');
      if (mode === 'LINK' && o.idea === undefined) throw new InputError('--mode link 需要 --idea <想法 id>');
      if (mode !== 'LINK' && o.idea !== undefined) throw new InputError('--idea 只能与 --mode link 一起使用');
      const id = parseId(opportunityId, '<opportunityId>');
      const result: ConvertResult = await apiClient.post(`${opportunitiesPath(productOf(o))}/${id}/convert-to-idea`,
        { mode, linkIdeaId: o.idea === undefined ? undefined : parseId(o.idea, '--idea') });
      emit(o.json, result, () => renderConvert(result ?? {}, id));
    }));
}

const AI_FILL_TIMEOUT_HINT = 'AI 填写可能仍在服务端执行，先用 competitor matrix 看有没有格子变成 AI 填写，不要立刻重复触发';

function registerAiFillCommand(root: Command): void {
  root.command('ai-fill').description('Have AI fill the "our product" column of the matrix from the requirement tree and use cases (a person only; costs Credits; person-written cells are never touched)')
    .option(...PRODUCT_OPT).option(...JSON_OPT)
    .action((o) => guarded('AI 填写失败', CODES, async () => {
      const result: AiFillResult = await apiClient.post(`${matrixPath(productOf(o))}/ai-fill`, undefined, AI_REQUEST_CONFIG)
        .catch((err: unknown) => { throw withTimeoutHint(err, AI_FILL_TIMEOUT_HINT); });
      emit(o.json, result, () => renderAiFill(result ?? {}));
    }));
}

export function registerCompetitorCommands(program: Command) {
  const root = program.command('competitor').description('Product competitor analysis: competitors, comparison matrix, sources, opportunities and gaps');
  // the server records the source of a change (audit, activity) from this header
  root.hook('preAction', () => apiClient.setDefaultHeader('X-Client-Channel', 'cli'));
  registerCrudCommands(root);
  registerCapabilityCommands(root);
  registerMatrixCommands(root);
  registerSourceCommands(root);
  registerOpportunityCommands(root);
  registerAiFillCommand(root);
}

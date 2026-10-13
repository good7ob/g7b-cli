import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { InputError, emit, fail, parseId } from '../../utils/cliHelpers';
import {
  buildAppBody, buildFlowBody, buildNodeBody, buildScreenBody, buildVersionBody, planScreenshots,
} from './input';
import {
  UiApp, UiFlow, UiFlowNode, UiScreen, UiScreenshot, UiVersion,
  renderApps, renderFlows, renderNodes, renderScreens, renderScreenshots, renderVersions,
} from './render';

/**
 * UI design commands (forge/uidesign): apps -> screens -> versions (design drafts) -> screenshots, plus
 * flows -> nodes (the screen-transition map). Reads need org membership, writes need an org owner/admin.
 *
 * The backend PUTs overwrite every field (a missing text field becomes ""), so each `update` first reads
 * the current row from the parent list (hence --app / --screen / --flow) and resends what you did not change.
 * Screenshot files are uploaded through POST /files (purpose UI_SCREENSHOT: images only, 10MB), then registered.
 */

const BASE = '/forge/ui-design';
const J = ['--json', 'Output as JSON'] as const;
const fmtId = (v: unknown) => `#${(v as { id?: number } | null)?.id ?? '-'}`;

/** Read the current row of an update from its parent's list; the backend has no single-row GET. */
async function findCurrent<T extends { id: number }>(listUrl: string, id: number, what: string): Promise<T> {
  const rows: T[] = (await apiClient.get(listUrl)) ?? [];
  const row = rows.find((r) => r.id === id);
  if (!row) throw new InputError(`${what} #${id} 不在 ${listUrl} 中（检查 --app / --screen / --flow 是否是它的上级）`);
  return row;
}

async function list<T>(url: string, params?: Record<string, number>): Promise<T[]> {
  return (await apiClient.get(url, params)) ?? [];
}

function registerAppCommands(ui: Command): void {
  const app = ui.command('app').description('UI design apps / platforms of an org');
  app.command('list').description('List apps of an org')
    .requiredOption('--org <id>', 'Org id').option(...J)
    .action(async (o) => {
      try {
        const rows = await list<UiApp>(`${BASE}/apps`, { orgId: parseId(o.org, '--org') });
        emit(o.json, rows, () => renderApps(rows));
      } catch (e) { fail('获取应用失败', e); }
    });
  app.command('create').description('Create an app (org owner/admin)')
    .requiredOption('--org <id>', 'Org id').requiredOption('--name <name>', 'Name (max 64, unique per org)')
    .requiredOption('--platform <p>', 'web|ios|android|miniprogram|other')
    .option('--description <text>', 'Description (max 512)').option('--sort <n>', 'Sort order').option(...J)
    .action(async (o) => {
      try {
        const created = await apiClient.post(`${BASE}/apps`, buildAppBody(o));
        emit(o.json, created, () => `✓ 应用已创建: ${fmtId(created)} ${o.name} (${o.platform})`);
      } catch (e) { fail('创建应用失败', e); }
    });
  app.command('delete <appId>').description('Delete an app AND all its screens, versions, screenshots, flows (org owner/admin)')
    .action(async (appId) => {
      try {
        await apiClient.delete(`${BASE}/apps/${parseId(appId, 'appId')}`);
        console.log(`✓ 应用已删除（含其下页面/版本/截图/流程）: #${appId}`);
      } catch (e) { fail('删除应用失败', e); }
    });
}

function withScreenFlags(cmd: Command): Command {
  return cmd.option('--name <name>', 'Screen name (max 128)').option('--code <code>', 'Screen code, e.g. SCR-WEB-HOME-001 (max 64)')
    .option('--route <path>', 'Route path (max 256)').option('--category <c>', 'Category (max 64)')
    .option('--status <s>', 'active|deprecated|planned (default planned)').option('--sort <n>', 'Sort order').option(...J);
}

function registerScreenCommands(ui: Command): void {
  const screen = ui.command('screen').description('Screens (pages) of an app');
  screen.command('list <appId>').description('List screens of an app').option(...J)
    .action(async (appId, o) => {
      try {
        const rows = await list<UiScreen>(`${BASE}/apps/${parseId(appId, 'appId')}/screens`);
        emit(o.json, rows, () => renderScreens(rows));
      } catch (e) { fail('获取页面失败', e); }
    });
  withScreenFlags(screen.command('create <appId>').description('Create a screen (org owner/admin); --name required'))
    .action(async (appId, o) => {
      try {
        const body = buildScreenBody(o);
        const created = await apiClient.post(`${BASE}/apps/${parseId(appId, 'appId')}/screens`, body);
        emit(o.json, created, () => `✓ 页面已创建: ${fmtId(created)} ${o.name}`);
      } catch (e) { fail('创建页面失败', e); }
    });
  withScreenFlags(screen.command('update <screenId>').description('Update a screen; unspecified fields keep their value')
    .requiredOption('--app <appId>', 'App the screen belongs to (used to read its current values)'))
    .action(async (screenId, o) => {
      try {
        const id = parseId(screenId, 'screenId');
        const appId = parseId(o.app, '--app');
        const current = await findCurrent<UiScreen>(`${BASE}/apps/${appId}/screens`, id, '页面');
        const updated = await apiClient.put(`${BASE}/screens/${id}`, buildScreenBody(o, current));
        emit(o.json, updated, () => `✓ 页面已更新: #${id}`);
      } catch (e) { fail('更新页面失败', e); }
    });
  screen.command('delete <screenId>').description('Delete a screen AND its versions / screenshots (org owner/admin)')
    .action(async (screenId) => {
      try {
        await apiClient.delete(`${BASE}/screens/${parseId(screenId, 'screenId')}`);
        console.log(`✓ 页面已删除: #${screenId}`);
      } catch (e) { fail('删除页面失败', e); }
    });
}

function withVersionFlags(cmd: Command): Command {
  return cmd.option('--type <t>', 'current|history|proposal').option('--label <text>', 'Label, e.g. v2.3 (max 128)')
    .option('--description <text>', 'Description (max 512)')
    .option('--active', 'Make this the active version of the screen (demotes the others)')
    .option('--inactive', 'Clear the active flag (update only)').option(...J);
}

function activeFlag(o: { active?: boolean; inactive?: boolean }): boolean | undefined {
  if (o.active && o.inactive) throw new InputError('--active 与 --inactive 不能同时使用');
  return o.active ? true : o.inactive ? false : undefined;
}

function registerVersionCommands(ui: Command): void {
  const version = ui.command('version').description('Design versions (drafts) of a screen');
  version.command('list <screenId>').description('List versions of a screen, newest first').option(...J)
    .action(async (screenId, o) => {
      try {
        const rows = await list<UiVersion>(`${BASE}/screens/${parseId(screenId, 'screenId')}/versions`);
        emit(o.json, rows, () => renderVersions(rows));
      } catch (e) { fail('获取版本失败', e); }
    });
  withVersionFlags(version.command('create <screenId>').description('Create a version; --type and --label required'))
    .action(async (screenId, o) => {
      try {
        const body = buildVersionBody({ ...o, active: activeFlag(o) });
        const created = await apiClient.post(`${BASE}/screens/${parseId(screenId, 'screenId')}/versions`, body);
        emit(o.json, created, () => `✓ 版本已创建: ${fmtId(created)} ${o.label}${o.active ? '（已设为当前激活）' : ''}`);
      } catch (e) { fail('创建版本失败', e); }
    });
  withVersionFlags(version.command('update <versionId>').description('Update a version; unspecified fields keep their value')
    .requiredOption('--screen <screenId>', 'Screen the version belongs to (used to read its current values)'))
    .action(async (versionId, o) => {
      try {
        const id = parseId(versionId, 'versionId');
        const current = await findCurrent<UiVersion>(`${BASE}/screens/${parseId(o.screen, '--screen')}/versions`, id, '版本');
        const updated = await apiClient.put(`${BASE}/versions/${id}`, buildVersionBody({ ...o, active: activeFlag(o) }, current));
        emit(o.json, updated, () => `✓ 版本已更新: #${id}`);
      } catch (e) { fail('更新版本失败', e); }
    });
  version.command('delete <versionId>').description('Delete a version AND its screenshots (org owner/admin)')
    .action(async (versionId) => {
      try {
        await apiClient.delete(`${BASE}/versions/${parseId(versionId, 'versionId')}`);
        console.log(`✓ 版本已删除: #${versionId}`);
      } catch (e) { fail('删除版本失败', e); }
    });
}

/** Upload one local image; returns the stored https URL. */
async function uploadImage(file: string, orgId?: number): Promise<string> {
  const fields: Record<string, string> = { purpose: 'UI_SCREENSHOT' };
  if (orgId !== undefined) fields.orgId = String(orgId);
  const uploaded = await apiClient.uploadFiles('/files', [file], 'file', fields);
  if (!uploaded?.fileUrl) throw new Error(`上传成功但没有返回 fileUrl: ${file}`);
  return uploaded.fileUrl;
}

function registerScreenshotCommands(ui: Command): void {
  const shot = ui.command('screenshot').description('Screenshots / design images of a version');
  shot.command('list <versionId>').description('List screenshots of a version').option(...J)
    .action(async (versionId, o) => {
      try {
        const rows = await list<UiScreenshot>(`${BASE}/versions/${parseId(versionId, 'versionId')}/screenshots`);
        emit(o.json, rows, () => renderScreenshots(rows));
      } catch (e) { fail('获取截图失败', e); }
    });
  shot.command('add <versionId>')
    .description('Add screenshots: upload local images (--file, repeatable) or register an uploaded https URL (--url)')
    .option('--file <path>', 'Local image (png/jpg/jpeg/gif/webp/bmp, <=10MB); repeat to add several', (v: string, p: string[] = []) => [...p, v])
    .option('--url <url>', 'Already-uploaded https image URL').option('--org <id>', 'Org that owns the uploaded file (--file only)')
    .option('--caption <text>', 'Caption (max 256; single image only)').option('--thumbnail <url>', 'Thumbnail https URL (single image only)')
    .option('--sort <n>', 'Sort order; with several files, the i-th gets n+i').option(...J)
    .action(async (versionId, o) => {
      const created: UiScreenshot[] = [];
      try {
        const id = parseId(versionId, 'versionId');
        const plan = planScreenshots(o);
        const sources = plan.url ? [plan.url] : plan.files;
        for (const [i, source] of sources.entries()) {
          const fileUrl = plan.url ?? (await uploadImage(source, plan.orgId));
          const body = { ...plan.base, fileUrl, ...(plan.base.sortOrder === undefined ? {} : { sortOrder: plan.base.sortOrder + i }) };
          created.push(await apiClient.post(`${BASE}/versions/${id}/screenshots`, body));
        }
        emit(o.json, created, () => created.map((c) => `✓ 截图已添加: ${fmtId(c)} ${c.fileUrl ?? ''}`).join('\n'));
      } catch (e) {
        if (created.length) console.error(`已成功添加 ${created.length} 张: ${created.map(fmtId).join(', ')}（其余未添加）`);
        fail('添加截图失败', e);
      }
    });
  shot.command('delete <screenshotId>').description('Delete a screenshot record (the stored file stays)')
    .action(async (screenshotId) => {
      try {
        await apiClient.delete(`${BASE}/screenshots/${parseId(screenshotId, 'screenshotId')}`);
        console.log(`✓ 截图已删除: #${screenshotId}`);
      } catch (e) { fail('删除截图失败', e); }
    });
}

function registerFlowCommands(ui: Command): void {
  const flow = ui.command('flow').description('Screen-transition flows (画面迁移图) of an app');
  const flags = (c: Command) => c.option('--name <name>', 'Flow name (max 128)').option('--description <text>', 'Description (max 512)')
    .option('--sort <n>', 'Sort order').option(...J);
  flow.command('list <appId>').description('List flows of an app').option(...J)
    .action(async (appId, o) => {
      try {
        const rows = await list<UiFlow>(`${BASE}/apps/${parseId(appId, 'appId')}/flows`);
        emit(o.json, rows, () => renderFlows(rows));
      } catch (e) { fail('获取流程失败', e); }
    });
  flags(flow.command('create <appId>').description('Create a flow; --name required'))
    .action(async (appId, o) => {
      try {
        const created = await apiClient.post(`${BASE}/apps/${parseId(appId, 'appId')}/flows`, buildFlowBody(o));
        emit(o.json, created, () => `✓ 流程已创建: ${fmtId(created)} ${o.name}`);
      } catch (e) { fail('创建流程失败', e); }
    });
  flags(flow.command('update <flowId>').description('Update a flow; unspecified fields keep their value')
    .requiredOption('--app <appId>', 'App the flow belongs to (used to read its current values)'))
    .action(async (flowId, o) => {
      try {
        const id = parseId(flowId, 'flowId');
        const current = await findCurrent<UiFlow>(`${BASE}/apps/${parseId(o.app, '--app')}/flows`, id, '流程');
        const updated = await apiClient.put(`${BASE}/flows/${id}`, buildFlowBody(o, current));
        emit(o.json, updated, () => `✓ 流程已更新: #${id}`);
      } catch (e) { fail('更新流程失败', e); }
    });
  flow.command('delete <flowId>').description('Delete a flow AND its nodes (org owner/admin)')
    .action(async (flowId) => {
      try {
        await apiClient.delete(`${BASE}/flows/${parseId(flowId, 'flowId')}`);
        console.log(`✓ 流程已删除: #${flowId}`);
      } catch (e) { fail('删除流程失败', e); }
    });
}

function registerNodeCommands(ui: Command): void {
  const node = ui.command('node').description('Transitions (from screen -> to screen) inside a flow');
  const flags = (c: Command) => c.option('--from <screenId>', 'Source screen (omit or use --entry for an entry node)')
    .option('--entry', 'Entry node: no source screen').option('--to <screenId>', 'Target screen (same app as the flow)')
    .option('--trigger <text>', 'What triggers it (max 256)').option('--condition <text>', 'Condition (max 256)')
    .option('--sort <n>', 'Sort order').option(...J);
  node.command('list <flowId>').description('List transitions of a flow').option('--app <appId>', 'Resolve screen names from this app').option(...J)
    .action(async (flowId, o) => {
      try {
        const rows = await list<UiFlowNode>(`${BASE}/flows/${parseId(flowId, 'flowId')}/nodes`);
        const screens = o.app ? await list<UiScreen>(`${BASE}/apps/${parseId(o.app, '--app')}/screens`) : undefined;
        const names = screens && new Map(screens.map((s) => [s.id, s.name ?? '']));
        emit(o.json, rows, () => renderNodes(rows, names));
      } catch (e) { fail('获取流程节点失败', e); }
    });
  flags(node.command('add <flowId>').description('Add a transition; --to required'))
    .action(async (flowId, o) => {
      try {
        const created = await apiClient.post(`${BASE}/flows/${parseId(flowId, 'flowId')}/nodes`, buildNodeBody(o));
        emit(o.json, created, () => `✓ 节点已添加: ${fmtId(created)}`);
      } catch (e) { fail('添加流程节点失败', e); }
    });
  flags(node.command('update <nodeId>').description('Update a transition; unspecified fields keep their value')
    .requiredOption('--flow <flowId>', 'Flow the node belongs to (used to read its current values)'))
    .action(async (nodeId, o) => {
      try {
        const id = parseId(nodeId, 'nodeId');
        const current = await findCurrent<UiFlowNode>(`${BASE}/flows/${parseId(o.flow, '--flow')}/nodes`, id, '节点');
        const updated = await apiClient.put(`${BASE}/nodes/${id}`, buildNodeBody(o, current));
        emit(o.json, updated, () => `✓ 节点已更新: #${id}`);
      } catch (e) { fail('更新流程节点失败', e); }
    });
  node.command('delete <nodeId>').description('Delete a transition')
    .action(async (nodeId) => {
      try {
        await apiClient.delete(`${BASE}/nodes/${parseId(nodeId, 'nodeId')}`);
        console.log(`✓ 节点已删除: #${nodeId}`);
      } catch (e) { fail('删除流程节点失败', e); }
    });
}

export function registerUiCommands(program: Command) {
  const ui = program.command('ui').description('UI design: screens, design drafts, screenshots and the screen-transition map');
  registerAppCommands(ui);
  registerScreenCommands(ui);
  registerVersionCommands(ui);
  registerScreenshotCommands(ui);
  registerFlowCommands(ui);
  registerNodeCommands(ui);
}

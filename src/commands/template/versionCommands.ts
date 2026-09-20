import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { emit, guarded, parseId } from '../../utils/cliHelpers';
import { TEMPLATE_ERROR_CODES as CODES } from './input';
import {
  DiffVo, VersionVo, renderDependencyList, renderDiff, renderVersion, renderVersionList,
} from './renderVersion';
import {
  DEPENDENCY_KINDS, buildDependency, buildVersionAddBody, buildVersionUpdateBody, loadDependencies, requireSemver,
} from './versionInput';

const BASE = '/templates';
const versionUrl = (id: string, version: string) => `${BASE}/${parseId(id, 'id')}/versions/${requireSemver(version, 'version')}`;

/** JSON payload flags shared by `create`, `version add` and `version update`. */
export function withPayloadFlags(cmd: Command): Command {
  return cmd
    .option('--changelog <text>', 'Change log (max 5000 chars)')
    .option('--content-file <file.json>', 'Content JSON file (structure per template type, see api-0091; max 1 MB, depth 32, 50,000 values)')
    .option('--content <json>', 'Content as an inline JSON string (same limits; alternative to --content-file)')
    .option('--variables-file <file.json>', 'Variables JSON array file (max 50 variables)')
    .option('--compatibility-file <file.json>', 'Compatibility JSON object file (max 4 KB)');
}

function submitOutcome(v: VersionVo, version: string): string {
  if (v?.status === 'PUBLISHED') return `✓ 版本 ${version} 已发布 (PUBLISHED)`;
  if (v?.status === 'REVIEWING') return `✓ 版本 ${version} 已提交审核 (REVIEWING)：内容已冻结，等待平台管理员审核`;
  return `✓ 版本 ${version} 已提交${v?.status ? ` (${v.status})` : ''}`;
}

function registerVersion(tpl: Command): void {
  const version = tpl.command('version').description('Template versions (x.y.z): draft, edit, list, submit');

  withPayloadFlags(version.command('add <id>'))
    .description('Add a DRAFT version (its number must be numerically greater than every existing version)')
    .requiredOption('--version <x.y.z>', 'Version number, e.g. 1.0.0')
    .option('--json', 'Output as JSON')
    .action((id, o) => guarded('创建版本失败', CODES, async () => {
      const tid = parseId(id, 'id');
      const body = buildVersionAddBody(o);
      const created: VersionVo = await apiClient.post(`${BASE}/${tid}/versions`, body);
      emit(o.json, created, () => `✓ 版本已创建 (${created?.status ?? 'DRAFT'}): 模板 #${tid} ${body.version}`);
    }));

  withPayloadFlags(version.command('update <id> <version>'))
    .description('Edit a DRAFT version (omitted flags stay unchanged; content and variables are re-validated together)')
    .option('--json', 'Output as JSON')
    .action((id, ver, o) => guarded('更新版本失败', CODES, async () => {
      const url = versionUrl(id, ver);
      const updated = await apiClient.put(url, buildVersionUpdateBody(o));
      emit(o.json, updated, () => `✓ 版本已更新: 模板 #${id} ${ver}`);
    }));

  version
    .command('list <id>')
    .description('List versions (no content); non-managers only see versions that were published')
    .option('--json', 'Output as JSON')
    .action((id, o) => guarded('获取版本列表失败', CODES, async () => {
      const result = await apiClient.get(`${BASE}/${parseId(id, 'id')}/versions`);
      emit(o.json, result, () => renderVersionList(result));
    }));

  version
    .command('get <id> <version>')
    .description('Show one version with content, variables and dependencies')
    .option('--json', 'Output as JSON')
    .action((id, ver, o) => guarded('获取版本失败', CODES, async () => {
      const detail: VersionVo = await apiClient.get(versionUrl(id, ver));
      emit(o.json, detail, () => renderVersion(detail));
    }));

  version
    .command('delete <id> <version>')
    .description('Delete a DRAFT version (soft delete, frees the version number)')
    .option('--json', 'Output as JSON')
    .action((id, ver, o) => guarded('删除版本失败', CODES, async () => {
      const url = versionUrl(id, ver);
      await apiClient.delete(url);
      emit(o.json, { deleted: true, id: Number(id), version: ver }, () => `✓ 版本已删除: 模板 #${id} ${ver}`);
    }));

  version
    .command('submit <id> <version>')
    .description('Submit a DRAFT version: PRIVATE / ORGANIZATION publish at once, PUBLIC goes to platform review (content freezes)')
    .option('--json', 'Output as JSON')
    .action((id, ver, o) => guarded('提交版本失败', CODES, async () => {
      const submitted: VersionVo = await apiClient.post(`${versionUrl(id, ver)}/submit`);
      emit(o.json, submitted, () => submitOutcome(submitted, ver));
    }));
}

function registerDependency(tpl: Command): void {
  const dep = tpl.command('dependency').description('Dependencies of a DRAFT version (max 20, no cycles; PUBLIC templates may only depend on PUBLIC ones)');

  dep
    .command('list <id> <version>')
    .description('List the dependencies of a version')
    .option('--json', 'Output as JSON')
    .action((id, ver, o) => guarded('获取依赖失败', CODES, async () => {
      const result = await apiClient.get(`${versionUrl(id, ver)}/dependencies`);
      emit(o.json, result, () => renderDependencyList(result));
    }));

  dep
    .command('set <id> <version>')
    .description('Replace ALL dependencies of a DRAFT version from a JSON file: [{"requiredTemplateId":7,"minVersion":"1.0.0","kind":"requires"}]')
    .requiredOption('--file <deps.json>', 'Dependencies file (an array, or {"dependencies": [...]}; max 20)')
    .option('--json', 'Output as JSON')
    .action((id, ver, o) => guarded('设置依赖失败', CODES, async () => {
      const url = versionUrl(id, ver);
      const dependencies = loadDependencies(o.file);
      const result = await apiClient.put(`${url}/dependencies`, { dependencies });
      emit(o.json, result, () => `✓ 依赖已替换: 模板 #${id} ${ver}，共 ${dependencies.length} 个\n${renderDependencyList(result)}`);
    }));

  dep
    .command('add <id> <version>')
    .description('Add one dependency to a DRAFT version')
    .requiredOption('--template <id>', 'Required template id')
    .option('--min-version <x.y.z>', 'Minimum version of the required template')
    .option('--kind <kind>', `Dependency kind (${DEPENDENCY_KINDS.join('|')}, default requires)`)
    .option('--json', 'Output as JSON')
    .action((id, ver, o) => guarded('添加依赖失败', CODES, async () => {
      const url = versionUrl(id, ver);
      const result = await apiClient.post(`${url}/dependencies`, buildDependency(o));
      emit(o.json, result, () => `✓ 依赖已添加: 模板 #${id} ${ver} → #${o.template}`);
    }));

  dep
    .command('rm <id> <version> <dependencyId>')
    .description('Remove one dependency (dependencyId from `dependency list`)')
    .option('--json', 'Output as JSON')
    .action((id, ver, depId, o) => guarded('删除依赖失败', CODES, async () => {
      const url = versionUrl(id, ver);
      const did = parseId(depId, 'dependencyId');
      const result = await apiClient.delete(`${url}/dependencies/${did}`);
      emit(o.json, result ?? { deleted: true, id: did }, () => `✓ 依赖已删除: #${did}`);
    }));
}

export function registerVersionCommands(tpl: Command): void {
  registerVersion(tpl);
  registerDependency(tpl);

  tpl
    .command('diff <id> <from> <to>')
    .description('What changed between two versions (content and variables: added / changed / removed)')
    .option('--json', 'Output as JSON')
    .action((id, from, to, o) => guarded('获取版本差异失败', CODES, async () => {
      const url = versionUrl(id, from);
      const result: DiffVo = await apiClient.get(`${url}/diff`, { to: requireSemver(to, 'to') });
      emit(o.json, result, () => renderDiff(result));
    }));
}

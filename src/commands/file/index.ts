import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { emit, guarded, parseId, parseIntInRange } from '../../utils/cliHelpers';
import { saveUrlTo } from './download';
import { FILE_ERROR_CODES as CODES, buildListParams, checkUploadFiles, parseObjectType, resolveOutPath } from './input';
import { AccessEntry, ObjectFilePage, ObjectFileVo, fmtSize, renderAccess, renderList, renderVersions } from './render';

/**
 * Object file commands (prd-0132, api-0130): the files that hang on an organization / product / project / task / PRD.
 * Permissions, quota and scanning are the server's; downloads go through a 5-minute signed address that is never
 * printed, so it cannot end up in a log or a task comment.
 */

export function registerFileCommands(program: Command) {
  const file = program.command('file').description('Object files — files on an org / product / project / task / PRD document');
  // the server's access log tells the CLI from the web page by this header
  file.hook('preAction', () => apiClient.setDefaultHeader('X-Client-Channel', 'cli'));

  file
    .command('list <objectType> <id>')
    .description('List the files of an object (org|product|project|task|prd-document)')
    .option('--source <source>', 'upload|export|deliverable|knowledge_base')
    .option('--keyword <text>', 'Match in file name or note')
    .option('--children', 'Include files of child objects you can see')
    .option('--page <n>', 'Page (default 1)')
    .option('--size <n>', 'Page size 1-100 (default 20)')
    .option('--json', 'Output as JSON')
    .action(async (objectType: string, id: string, o) =>
      guarded('列出文件失败', CODES, async () => {
        const type = parseObjectType(objectType);
        const page: ObjectFilePage = await apiClient.get(`/objects/${type}/${parseId(id, '<id>')}/files`, buildListParams(o));
        emit(o.json, page, () => renderList(page));
      })
    );

  file
    .command('upload <objectType> <id> <paths...>')
    .description('Upload local files onto an object; a same-name file becomes its next version')
    .option('--note <text>', 'Short description (max 500 characters)')
    .option('--new-file', 'Keep a separate file instead of a new version of the same-name file')
    .option('--json', 'Output as JSON')
    .action(async (objectType: string, id: string, paths: string[], o) =>
      guarded('上传文件失败', CODES, async () => {
        const type = parseObjectType(objectType);
        const objectId = parseId(id, '<id>');
        const files = checkUploadFiles(paths);
        if (o.note && o.note.length > 500) throw new Error('--note 最长 500 个字符');
        const fields: Record<string, string> = {};
        if (o.note) fields.note = o.note;
        if (o.newFile) fields.asNewFile = 'true';
        const saved: ObjectFileVo[] = [];
        for (const p of files) {
          saved.push(await apiClient.uploadFiles(`/objects/${type}/${objectId}/files`, [p], 'file', fields));
        }
        emit(o.json, saved, () =>
          saved.map((f) => `已上传 #${f.fileId} ${f.fileName} v${f.versionNo}（${fmtSize(f.sizeBytes)}）${f.scanStatus === 'pending' ? ' 扫描中，通过后才能下载' : ''}`).join('\n')
        );
      })
    );

  file
    .command('versions <fileId>')
    .description('Version history of a file')
    .option('--json', 'Output as JSON')
    .action(async (fileId: string, o) =>
      guarded('读取版本失败', CODES, async () => {
        const versions: ObjectFileVo[] = await apiClient.get(`/files/${parseId(fileId, '<fileId>')}/versions`);
        emit(o.json, versions, () => renderVersions(versions));
      })
    );

  file
    .command('download <fileId>')
    .description('Download a file (or one version) to a local path; an existing file is kept unless --force')
    .option('--version <n>', 'A specific version number')
    .option('--out <path>', 'File path, or a directory (default: current directory, original name)')
    .option('--force', 'Overwrite an existing file')
    .action(async (fileId: string, o) =>
      guarded('下载文件失败', CODES, async () => {
        const id = parseId(fileId, '<fileId>');
        const version = o.version === undefined ? undefined : parseId(o.version, '--version');
        const versions: ObjectFileVo[] = await apiClient.get(`/files/${id}/versions`);
        const picked = (version === undefined ? versions.find((v) => v.fileId === id) : versions.find((v) => v.versionNo === version)) ?? versions[0];
        if (!picked) throw new Error('文件不存在');
        const dest = resolveOutPath(o.out, picked.fileName, Boolean(o.force));
        const signed: { url: string } = await apiClient.get(`/files/${id}/download-url`, version === undefined ? undefined : { version });
        const bytes = await saveUrlTo(signed.url, dest);
        console.log(`已保存 ${dest}（${fmtSize(bytes)}）`);
      })
    );

  file
    .command('kb <fileId>')
    .description("Switch a file into or out of its product's knowledge base (pdf/docx/md/txt, ≤ 20 MB, not confidential)")
    .option('--on', 'Add to the knowledge base')
    .option('--off', 'Remove from the knowledge base')
    .action(async (fileId: string, o) =>
      guarded('更新知识库开关失败', CODES, async () => {
        if (Boolean(o.on) === Boolean(o.off)) throw new Error('--on 与 --off 必须二选一');
        await apiClient.put(`/files/${parseId(fileId, '<fileId>')}/kb`, { enabled: Boolean(o.on) });
        console.log(o.on ? '已存入知识库' : '已移出知识库');
      })
    );

  file
    .command('confidential <fileId>')
    .description('Mark a file (all versions) confidential, or not: it never reaches an AI context and leaves the knowledge base')
    .option('--on', 'Mark as confidential')
    .option('--off', 'Remove the mark')
    .action(async (fileId: string, o) =>
      guarded('更新机密标记失败', CODES, async () => {
        if (Boolean(o.on) === Boolean(o.off)) throw new Error('--on 与 --off 必须二选一');
        await apiClient.put(`/files/${parseId(fileId, '<fileId>')}/confidential`, { value: Boolean(o.on) });
        console.log(o.on ? '已标记为机密（已入库的副本已移出知识库）' : '已取消机密标记');
      })
    );

  file
    .command('history <fileId>')
    .description('Who uploaded, downloaded, deleted ... a file (organization owner / admin)')
    .option('--limit <n>', 'Newest entries to show, 1-200 (default 100)')
    .option('--json', 'Output as JSON')
    .action(async (fileId: string, o) =>
      guarded('读取访问记录失败', CODES, async () => {
        const limit = o.limit === undefined ? 100 : parseIntInRange(o.limit, '--limit', 1, 200);
        const entries: AccessEntry[] = await apiClient.get(`/files/${parseId(fileId, '<fileId>')}/access`, { limit });
        emit(o.json, entries, () => renderAccess(entries));
      })
    );

  file
    .command('delete <fileId>')
    .description('Delete a file with all its versions (an admin can restore it within 30 days)')
    .action(async (fileId: string) =>
      guarded('删除文件失败', CODES, async () => {
        await apiClient.delete(`/files/${parseId(fileId, '<fileId>')}`);
        console.log('已删除（30 天内组织 owner / admin 可恢复）');
      })
    );
}

import { Command } from 'commander';
import fs from 'fs';
import apiClient from '../../services/ApiClient';
import { InputError, parseId } from '../../utils/cliHelpers';
import { fromCanvasView, parseArchFile } from './cloudArchFile';

const BASE = '/forge/cloud-arch/diagrams';

function fail(what: string, e: unknown): never {
  console.error(`✗ ${what}:`, e instanceof Error ? e.message : String(e));
  process.exit(1);
}

export function registerCloudArchCommands(program: Command) {
  const cmd = program.command('cloud-arch').description('Forge 云架构设计：架构图列表、上传（导入）、导出');

  cmd.command('list').description('列出组织下的架构图')
    .requiredOption('--org <id>', '组织 ID').option('--json', '输出 JSON')
    .action(async (o) => {
      try {
        const rows = (await apiClient.get(BASE, { orgId: parseId(o.org, '--org') })) ?? [];
        if (o.json) return console.log(JSON.stringify(rows, null, 2));
        rows.forEach((d: any) => console.log(`${String(d.id).padStart(5)}  ${String(d.env).padEnd(5)} ${String(d.platform).padEnd(6)} ${d.status.padEnd(9)} ${d.name}`));
      } catch (e) { fail('列出架构图失败', e); }
    });

  cmd.command('import')
    .description('上传架构图 JSON：同组织同名则整图替换，否则新建；缺坐标的节点自动排布')
    .requiredOption('--org <id>', '目标组织 ID（需 owner/admin）')
    .requiredOption('--file <json>', '架构图 JSON 文件（见 cloud-arch export 的格式）')
    .option('--json', '输出 JSON')
    .action(async (o) => {
      try {
        let raw: unknown;
        try { raw = JSON.parse(fs.readFileSync(o.file, 'utf8')); } catch (e) { throw new InputError(`无法读取 --file ${o.file}: ${e instanceof Error ? e.message : e}`); }
        const file = parseArchFile(raw);
        const view = await apiClient.post(`${BASE}/import`, { ...file, orgId: parseId(o.org, '--org') });
        if (o.json) return console.log(JSON.stringify(view, null, 2));
        console.log(`✓ 已上传 #${view.diagram.id} ${view.diagram.name} — 节点 ${view.nodes.length}，连线 ${view.connections.length}`);
      } catch (e) { fail('上传架构图失败', e); }
    });

  cmd.command('export <diagramId>')
    .description('导出架构图为 import 可用的 JSON（默认打印到标准输出）')
    .option('--out <file>', '写入文件')
    .action(async (diagramId, o) => {
      try {
        const view = await apiClient.get(`${BASE}/${parseId(diagramId, 'diagramId')}/canvas`);
        const text = JSON.stringify(fromCanvasView(view), null, 2) + '\n';
        if (o.out) { fs.writeFileSync(o.out, text); console.log(`✓ 已导出到 ${o.out}`); } else process.stdout.write(text);
      } catch (e) { fail('导出架构图失败', e); }
    });
}

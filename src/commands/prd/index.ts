import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { extractRecords } from '../../utils/extractRecords';

export function registerPrdCommands(program: Command) {
  const prdCommand = program
    .command('prd')
    .description('PRD management — sessions, documents, templates, task breakdown');

  // ── Session Query ──────────────────────────────────────────────

  prdCommand
    .command('sessions')
    .description('List PRD sessions')
    .option('--status <status>', 'Filter by status (active|archived|deleted)')
    .option('-p, --page <num>', 'Page number', '1')
    .option('-l, --limit <num>', 'Items per page', '20')
    .option('--json', 'Output as JSON')
    .option('--csv', 'Output as CSV')
    .action(async (options) => {
      try {
        const params: any = {
          page: parseInt(options.page) || 1,
          pageSize: parseInt(options.limit) || 20,
        };
        if (options.status) params.status = options.status;

        const result = await apiClient.get('/forge/prd/sessions', params);
        // fix: #4 https://github.com/good7ob/g7b-cli/issues/4
        const records = extractRecords(result);

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        if (options.csv) {
          console.log('ID,Title,Status,CreatedAt,UpdatedAt');
          records.forEach((s: any) => {
            console.log(`${s.id},"${(s.title || '').replace(/"/g, '""')}",${s.status || ''},${s.createdAt || ''},${s.updatedAt || ''}`);
          });
          return;
        }

        if (!records.length) {
          console.log('No PRD sessions found.');
          return;
        }

        console.log('\nPRD 会话列表');
        console.log('─'.repeat(85));
        console.log('ID'.padEnd(10) + '标题'.padEnd(35) + '状态'.padEnd(12) + '创建时间'.padEnd(22) + '更新时间');
        console.log('─'.repeat(85));
        records.forEach((s: any) => {
          console.log(
            String(s.id).padEnd(10) +
            (s.title || '-').substring(0, 33).padEnd(35) +
            (s.status || '-').padEnd(12) +
            (s.createdAt || '-').padEnd(22) +
            (s.updatedAt || '-')
          );
        });
        console.log('─'.repeat(85));
        if (result?.total) {
          console.log(`共 ${result.total} 条，第 ${params.page}/${Math.ceil(result.total / params.pageSize)} 页`);
        }
      } catch (error) {
        console.error('✗ 获取 PRD 会话列表失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  prdCommand
    .command('session-get <session-id>')
    .description('Get PRD session details')
    .option('--json', 'Output as JSON')
    .action(async (sessionId, options) => {
      try {
        const session = await apiClient.get(`/forge/prd/session/${sessionId}`);
        if (options.json) {
          console.log(JSON.stringify(session, null, 2));
          return;
        }
        console.log('\nPRD 会话详情');
        console.log('─'.repeat(55));
        console.log(`ID:       ${session.id}`);
        console.log(`标题:     ${session.title || '-'}`);
        console.log(`状态:     ${session.status || '-'}`);
        console.log(`项目 ID:  ${session.projectId || '-'}`);
        console.log(`语言:     ${session.language || '-'}`);
        console.log(`创建时间: ${session.createdAt || '-'}`);
        console.log(`更新时间: ${session.updatedAt || '-'}`);
        console.log('─'.repeat(55));
      } catch (error) {
        console.error('✗ 获取会话详情失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  prdCommand
    .command('session-rename <session-id>')
    .description('Rename a PRD session')
    .requiredOption('--title <title>', 'New session title')
    .action(async (sessionId, options) => {
      try {
        await apiClient.put(`/forge/prd/session/${sessionId}/rename`, { title: options.title });
        console.log(`✓ 会话已重命名: ${sessionId} → "${options.title}"`);
      } catch (error) {
        console.error('✗ 重命名失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  prdCommand
    .command('session-archive <session-id>')
    .description('Archive a PRD session')
    .action(async (sessionId) => {
      try {
        await apiClient.post(`/forge/prd/session/${sessionId}/archive`);
        console.log(`✓ 会话已归档: ${sessionId}`);
      } catch (error) {
        console.error('✗ 归档失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  prdCommand
    .command('session-restore <session-id>')
    .description('Restore an archived PRD session')
    .action(async (sessionId) => {
      try {
        await apiClient.post(`/forge/prd/session/${sessionId}/restore`);
        console.log(`✓ 会话已恢复: ${sessionId}`);
      } catch (error) {
        console.error('✗ 恢复失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  prdCommand
    .command('session-delete <session-id>')
    .description('Delete a PRD session')
    .option('--permanent', 'Permanently delete (cannot be restored)')
    .option('-f, --force', 'Skip confirmation')
    .action(async (sessionId, options) => {
      try {
        if (!options.force) {
          console.log(`⚠ 即将删除会话 ${sessionId}，使用 -f/--force 确认`);
          process.exit(0);
        }
        const permanent = options.permanent || false;
        await apiClient.delete(`/forge/prd/session/${sessionId}?permanent=${permanent}`);
        console.log(`✓ 会话已${permanent ? '永久' : ''}删除: ${sessionId}`);
      } catch (error) {
        console.error('✗ 删除失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // ── Document Query ─────────────────────────────────────────────

  prdCommand
    .command('get <id>')
    .description('Get PRD document details')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      try {
        const doc = await apiClient.get(`/forge/prd/${id}`);
        if (options.json) {
          console.log(JSON.stringify(doc, null, 2));
          return;
        }
        console.log('\nPRD 文档详情');
        console.log('─'.repeat(55));
        console.log(`ID:       ${doc.id}`);
        console.log(`标题:     ${doc.title || '-'}`);
        console.log(`版本:     ${doc.version || '-'}`);
        console.log(`状态:     ${doc.status || '-'}`);
        console.log(`会话 ID:  ${doc.chatId || doc.sessionId || '-'}`);
        console.log(`语言:     ${doc.language || '-'}`);
        console.log(`创建时间: ${doc.createdAt || '-'}`);
        if (doc.content) {
          console.log('\n内容摘要:');
          console.log(String(doc.content).substring(0, 300) + (doc.content.length > 300 ? '...' : ''));
        }
        console.log('─'.repeat(55));
      } catch (error) {
        console.error('✗ 获取 PRD 文档失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  prdCommand
    .command('versions <chat-id>')
    .description('List all PRD versions for a session')
    .option('--json', 'Output as JSON')
    .action(async (chatId, options) => {
      try {
        const versions = await apiClient.get(`/forge/prd/versions/${chatId}`);
        if (options.json) {
          console.log(JSON.stringify(versions, null, 2));
          return;
        }
        const list = Array.isArray(versions) ? versions : [];
        if (!list.length) {
          console.log('No versions found.');
          return;
        }
        console.log(`\nPRD 版本列表 — 会话 ${chatId}`);
        console.log('─'.repeat(70));
        console.log('ID'.padEnd(10) + '版本'.padEnd(10) + '标题'.padEnd(30) + '创建时间');
        console.log('─'.repeat(70));
        list.forEach((v: any) => {
          console.log(
            String(v.id).padEnd(10) +
            (v.version || '-').padEnd(10) +
            (v.title || '-').substring(0, 28).padEnd(30) +
            (v.createdAt || '-')
          );
        });
        console.log('─'.repeat(70));
      } catch (error) {
        console.error('✗ 获取版本列表失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // ── Export ─────────────────────────────────────────────────────

  prdCommand
    .command('export <id>')
    .description('Export a PRD document')
    .option('--format <fmt>', 'Export format (markdown|pdf|docx)', 'markdown')
    .option('--json', 'Output result as JSON')
    .action(async (id, options) => {
      try {
        const result = await apiClient.post(`/forge/prd/${id}/export?format=${options.format}`);
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.log(`✓ 导出成功: ${result?.fileId || result?.downloadUrl || ''}`);
        if (result?.downloadUrl) {
          console.log(`  下载地址: ${result.downloadUrl}`);
        }
      } catch (error) {
        console.error('✗ 导出失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // ── Templates ──────────────────────────────────────────────────

  prdCommand
    .command('templates')
    .description('List all available PRD templates')
    .option('--region <region>', 'Filter by region')
    .option('--category <category>', 'Filter by category')
    .option('--mine', 'Show only my custom templates')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        let url = '/forge/prd/templates';
        if (options.mine) url = '/forge/prd/templates/mine';
        const params: any = {};
        if (options.region) params.region = options.region;
        if (options.category) params.category = options.category;

        const templates = await apiClient.get(url, params);
        if (options.json) {
          console.log(JSON.stringify(templates, null, 2));
          return;
        }
        const list = Array.isArray(templates) ? templates : [];
        if (!list.length) {
          console.log('No templates found.');
          return;
        }
        console.log('\nPRD 模板列表');
        console.log('─'.repeat(75));
        console.log('ID'.padEnd(8) + 'Code'.padEnd(16) + '名称'.padEnd(28) + '分类'.padEnd(12) + '使用次数');
        console.log('─'.repeat(75));
        list.forEach((t: any) => {
          console.log(
            String(t.id).padEnd(8) +
            (t.code || '-').padEnd(16) +
            (t.name || '-').substring(0, 26).padEnd(28) +
            (t.category || '-').padEnd(12) +
            String(t.usageCount || 0)
          );
        });
        console.log('─'.repeat(75));
      } catch (error) {
        console.error('✗ 获取模板列表失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // ── Task Breakdown (批量导入) ───────────────────────────────────

  prdCommand
    .command('breakdown <prd-id>')
    .description('Preview task breakdown generated from a PRD document')
    .option('--lang <language>', 'Language for task generation', 'zh')
    .option('--min-size <n>', 'Minimum task size (hours)', '2')
    .option('--max-size <n>', 'Maximum task size (hours)', '8')
    .option('--json', 'Output as JSON')
    .action(async (prdId, options) => {
      try {
        const body: any = {
          language: options.lang,
          taskSizeMin: parseInt(options.minSize),
          taskSizeMax: parseInt(options.maxSize),
        };
        const result = await apiClient.post(`/forge/prd/${prdId}/breakdown`, body);
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        const tasks = result?.tasks || result || [];
        console.log(`\nPRD 任务拆解预览 — PRD ${prdId}`);
        console.log('─'.repeat(85));
        console.log('序号'.padEnd(6) + '任务名称'.padEnd(35) + '类型'.padEnd(12) + '预估(h)'.padEnd(10) + '角色');
        console.log('─'.repeat(85));
        tasks.forEach((t: any, i: number) => {
          console.log(
            String(i + 1).padEnd(6) +
            (t.name || t.title || '').substring(0, 33).padEnd(35) +
            (t.taskType || t.type || '-').padEnd(12) +
            String(t.estimatedHours || t.estimate || '-').padEnd(10) +
            (t.role || t.assigneeRole || '-')
          );
        });
        console.log('─'.repeat(85));
        console.log(`共 ${tasks.length} 个任务（预览）`);
        console.log('使用 "prd breakdown-import" 命令导入到项目');
      } catch (error) {
        console.error('✗ 任务拆解失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  prdCommand
    .command('breakdown-import <prd-id>')
    .description('Batch import tasks from PRD breakdown into a project')
    .requiredOption('--project-id <id>', 'Target project ID')
    .option('--project-name <name>', 'Project name (if creating new project)')
    .option('--project-desc <desc>', 'Project description')
    .option('--lang <language>', 'Language for task generation', 'zh')
    .option('--min-size <n>', 'Minimum task size (hours)', '2')
    .option('--max-size <n>', 'Maximum task size (hours)', '8')
    .option('--preview', 'Preview tasks before importing (dry run)')
    .option('--json', 'Output result as JSON')
    .action(async (prdId, options) => {
      try {
        // Step 1: generate breakdown
        console.log(`ℹ 正在拆解 PRD ${prdId}...`);
        const breakdown = await apiClient.post(`/forge/prd/${prdId}/breakdown`, {
          language: options.lang,
          taskSizeMin: parseInt(options.minSize),
          taskSizeMax: parseInt(options.maxSize),
        });
        const tasks = breakdown?.tasks || breakdown || [];

        if (!tasks.length) {
          console.log('⚠ 未生成任何任务');
          return;
        }

        console.log(`ℹ 已生成 ${tasks.length} 个任务`);

        if (options.preview) {
          console.log('\n预览（使用 --json 查看完整内容）:');
          tasks.slice(0, 10).forEach((t: any, i: number) => {
            console.log(`  ${i + 1}. ${t.name || t.title || ''}`);
          });
          if (tasks.length > 10) console.log(`  ... 共 ${tasks.length} 个`);
          console.log('\n去掉 --preview 参数后将实际导入');
          return;
        }

        // Step 2: confirm and batch create
        const confirmBody: any = {
          projectId: parseInt(options.projectId),
          tasks,
        };
        if (options.projectName) confirmBody.projectName = options.projectName;
        if (options.projectDesc) confirmBody.projectDescription = options.projectDesc;

        const result = await apiClient.post(`/forge/prd/${prdId}/breakdown/confirm`, confirmBody);

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const created = result?.createdCount ?? result?.tasks?.length ?? tasks.length;
        console.log(`✓ 已批量导入 ${created} 个任务到项目 ${options.projectId}`);
        if (result?.projectId) console.log(`  项目 ID: ${result.projectId}`);
        if (result?.failed?.length) {
          console.log(`⚠ 失败 ${result.failed.length} 个`);
        }
      } catch (error) {
        console.error('✗ 批量导入失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // ── Compare ────────────────────────────────────────────────────

  prdCommand
    .command('compare')
    .description('Compare two PRD versions')
    .option('--source-id <id>', 'Source PRD document ID')
    .option('--target-id <id>', 'Target PRD document ID')
    .option('--chat-id <id>', 'Session ID (use with --source-ver and --target-ver)')
    .option('--source-ver <ver>', 'Source version string (e.g. v1)')
    .option('--target-ver <ver>', 'Target version string (e.g. v2)')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        let result: any;
        if (options.chatId && options.sourceVer && options.targetVer) {
          result = await apiClient.get(`/forge/prd/compare/${options.chatId}`, {
            sourceVersion: options.sourceVer,
            targetVersion: options.targetVer,
          });
        } else if (options.sourceId && options.targetId) {
          result = await apiClient.get('/forge/prd/compare', {
            sourceId: options.sourceId,
            targetId: options.targetId,
          });
        } else {
          console.error('✗ 请提供 (--source-id + --target-id) 或 (--chat-id + --source-ver + --target-ver)');
          process.exit(1);
        }

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.log('\nPRD 版本对比');
        console.log('─'.repeat(60));
        if (result?.diff) {
          console.log(result.diff);
        } else {
          console.log(JSON.stringify(result, null, 2));
        }
        console.log('─'.repeat(60));
      } catch (error) {
        console.error('✗ 版本对比失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  return prdCommand;
}

import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import apiClient from '../../services/ApiClient';
import { generateEnvelopeTemplate } from '../../templates/taskEnvelope';

function toKebabCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}

function safeGitBranch(repoDir: string, branchName: string) {
  try {
    if (!fs.existsSync(repoDir)) return;
    const status = execSync('git status --porcelain', { cwd: repoDir, encoding: 'utf8' }).trim();
    if (status.length > 0) {
      console.warn(chalk.yellow(`  ⚠ 仓库 ${path.basename(repoDir)} 存在未提交修改，已跳过自动分支切换以防代码覆盖`));
      return;
    }
    execSync(`git checkout -B ${branchName}`, { cwd: repoDir, encoding: 'utf8', stdio: 'pipe' });
    console.log(chalk.gray(`  ✓ ${path.basename(repoDir)}: 切换至分支 '${branchName}'`));
  } catch (err: any) {
    console.warn(chalk.yellow(`  ⚠ ${path.basename(repoDir)} 分支切换跳过: ${err?.message || err}`));
  }
}

export function registerInitCommand(featCommand: Command) {
  featCommand
    .command('init')
    .description('一键初始化特性：注入上下文信封、创建平台父任务与4个子任务、本地镜像与设计仓库分支')
    .requiredOption('--name <name>', '特性功能名称')
    .requiredOption('--project-id <id>', '所属 Good7ob 项目 ID')
    .option('--slug <slug>', '英文短链标识（缺省自动从名称转写）')
    .option('--level <level>', '目标交付等级 (L1|L2|L3|L4|L5)', 'L3')
    .option('--intent <intent>', '特性简要意图背景说明')
    .option('--spec-file <file>', '直接导入现成任务信封 Markdown 文件')
    .option('--json', '以 JSON 格式输出初始化结果')
    .action(async (options) => {
      try {
        const projectId = parseInt(options.projectId, 10);
        const featName = options.name.trim();
        const slug = options.slug ? toKebabCase(options.slug) : toKebabCase(featName) || 'feature';
        const level = options.level || 'L3';

        console.log(`\n${chalk.bold.blue('🚀 初始化特性全生命周期')} : "${featName}" (项目 ID: ${projectId}, Slug: ${slug})`);
        console.log('─'.repeat(75));

        // 1. Prepare Envelope
        let envelopeContent = '';
        if (options.specFile && fs.existsSync(options.specFile)) {
          envelopeContent = fs.readFileSync(options.specFile, 'utf8');
        } else {
          envelopeContent = generateEnvelopeTemplate({
            name: featName,
            slug,
            level,
            intent: options.intent,
          });
        }

        // 2. Create Platform Tasks
        console.log(chalk.bold('\n[1/3] 平台任务编排 (Good7ob PM API)'));
        const parentTask = await apiClient.post('/progress/tasks', {
          projectId,
          name: `${featName} 全生命周期规范实施`,
          description: envelopeContent,
          priority: 'high',
          status: 'not_started',
          estimatedHours: 15.0,
        });
        const parentId = parentTask.id;
        console.log(chalk.green(`  ✓ 创建父任务: #${parentId} - ${featName} 全生命周期规范实施`));

        const sub1 = await apiClient.post('/progress/tasks', {
          projectId,
          parentTaskId: parentId,
          name: `PRD: ${featName} 功能设计与需求点制定 (good7ob/prd)`,
          description: '建立 PRD 文档，定义业务规则、RP 与 Gherkin 验收场景。',
          priority: 'high',
          status: 'not_started',
          estimatedHours: 4.0,
        });
        console.log(chalk.green(`  ✓ 创建子任务 1 (PRD): #${sub1.id}`));

        const sub2 = await apiClient.post('/progress/tasks', {
          projectId,
          parentTaskId: parentId,
          name: `Wireframe: ${featName} 画面清单与原型定义 (good7ob/wireframe)`,
          description: '建立画面规格说明 spec.md、HTML 原型 wireframe.html，并更新画面清单与总览。',
          priority: 'high',
          status: 'not_started',
          estimatedHours: 3.5,
        });
        console.log(chalk.green(`  ✓ 创建子任务 2 (Wireframe): #${sub2.id}`));

        const sub3 = await apiClient.post('/progress/tasks', {
          projectId,
          parentTaskId: parentId,
          name: `详细设计: ${featName} 架构设计、时序与契约定义 (good7ob/detailed-design-document)`,
          description: '编写详细设计技术规格书与 PlantUML 时序图，规范组件、状态与前后端交互契约。',
          priority: 'high',
          status: 'not_started',
          estimatedHours: 4.0,
        });
        console.log(chalk.green(`  ✓ 创建子任务 3 (Detailed Design): #${sub3.id}`));

        const sub4 = await apiClient.post('/progress/tasks', {
          projectId,
          parentTaskId: parentId,
          name: `测试用例与 E2E: ${featName} BDD 场景与自动化测试套件 (front-web/e2e)`,
          description: '根据 PRD 的 AC 编写 Playwright BDD E2E 测试特性文件与真实断言步骤。',
          priority: 'high',
          status: 'not_started',
          estimatedHours: 3.5,
        });
        console.log(chalk.green(`  ✓ 创建子任务 4 (Test Suite & E2E): #${sub4.id}`));

        // 3. Mirror in Local Admin Cockpit Database if exists
        console.log(chalk.bold('\n[2/3] 本地管理平台镜像 (Admin Cockpit dev.db)'));
        const adminDbPath = path.resolve(process.env.ADMIN_DB_PATH || '/Users/talkbear/Work/admin/prisma/dev.db');
        if (fs.existsSync(adminDbPath)) {
          try {
            // Using sqlite3 CLI if available or python
            const mirrorScript = `
import sqlite3, uuid, datetime
conn = sqlite3.connect('${adminDbPath}')
cur = conn.cursor()
cur.execute("SELECT id FROM Project WHERE good7obProjectId=${projectId}")
row = cur.fetchone()
if row:
    proj_id = row[0]
    p_id = 'c' + uuid.uuid4().hex[:24]
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    cur.execute("INSERT INTO Task (id, title, description, status, priority, good7obTaskId, good7obUrl, estimatedHours, projectId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (p_id, "${featName} 全生命周期规范实施", "标准流水线 Parent 任务", "not_started", "high", ${parentId}, "https://good7ob.net/projectManagement/detail/${projectId}?taskId=${parentId}", 15.0, proj_id, now, now))
    cur.execute("INSERT INTO Task (id, title, description, status, priority, good7obTaskId, good7obUrl, estimatedHours, projectId, parentId, artifactType, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ('c' + uuid.uuid4().hex[:24], "PRD: ${featName} (good7ob/prd)", "", "not_started", "high", ${sub1.id}, "https://good7ob.net/projectManagement/detail/${projectId}?taskId=${sub1.id}", 4.0, proj_id, p_id, "design_doc", now, now))
    cur.execute("INSERT INTO Task (id, title, description, status, priority, good7obTaskId, good7obUrl, estimatedHours, projectId, parentId, artifactType, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ('c' + uuid.uuid4().hex[:24], "Wireframe: ${featName} (good7ob/wireframe)", "", "not_started", "high", ${sub2.id}, "https://good7ob.net/projectManagement/detail/${projectId}?taskId=${sub2.id}", 3.5, proj_id, p_id, "design_doc", now, now))
    cur.execute("INSERT INTO Task (id, title, description, status, priority, good7obTaskId, good7obUrl, estimatedHours, projectId, parentId, artifactType, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ('c' + uuid.uuid4().hex[:24], "详细设计: ${featName} (good7ob/detailed-design-document)", "", "not_started", "high", ${sub3.id}, "https://good7ob.net/projectManagement/detail/${projectId}?taskId=${sub3.id}", 4.0, proj_id, p_id, "design_doc", now, now))
    cur.execute("INSERT INTO Task (id, title, description, status, priority, good7obTaskId, good7obUrl, estimatedHours, projectId, parentId, artifactType, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ('c' + uuid.uuid4().hex[:24], "测试用例与 E2E: ${featName} (front-web/e2e)", "", "not_started", "high", ${sub4.id}, "https://good7ob.net/projectManagement/detail/${projectId}?taskId=${sub4.id}", 3.5, proj_id, p_id, "test_report", now, now))
    conn.commit()
    print("OK")
else:
    print("NO_PROJECT")
`;
            const out = execSync(`python3 -c "${mirrorScript.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
            if (out.includes('OK')) {
              console.log(chalk.green('  ✓ 成功镜像至本地项目任务列表'));
            } else {
              console.log(chalk.gray(`  • 本地 dev.db 未找到 good7obProjectId=${projectId} 的项目，跳过本地镜像`));
            }
          } catch (err: any) {
            console.warn(chalk.yellow(`  ⚠ 本地数据库镜像跳过: ${err?.message || err}`));
          }
        }

        // 4. Multi-Repo Branch Switching
        console.log(chalk.bold('\n[3/3] 设计规范仓库分支联动'));
        const rootDir = process.env.GOOD7OB_ROOT || path.resolve(process.cwd(), '..');
        const branchName = `feat/${parentId}-${slug}`;
        safeGitBranch(path.join(rootDir, 'prd'), branchName);
        safeGitBranch(path.join(rootDir, 'wireframe'), `${branchName}-wireframe`);
        safeGitBranch(path.join(rootDir, 'detailed-design-document'), `${branchName}-detailed-design`);

        console.log(chalk.green('\n✅ 初始化完成！已建立标准任务信封与 4 阶段子任务。'));
        console.log(chalk.cyan(`   前置门禁验证指令: g7b feat verify ${parentId}\n`));

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                parentId,
                subtasks: [sub1.id, sub2.id, sub3.id, sub4.id],
                branchName,
              },
              null,
              2
            )
          );
        }
      } catch (error: any) {
        console.error(chalk.red(`✗ 初始化失败: ${error?.message || error}`));
        process.exit(1);
      }
    });
}

/**
 * Cloud Resource Management Commands
 *
 * Subcommands:
 * - infra resource list: List cloud resources
 * - infra resource get: Get resource details
 * - infra resource import: Batch import resources
 * - infra resource export: Export resource inventory
 */

import { Command } from 'commander';
import apiClient from '../../../services/ApiClient';

export function registerResourceCommands(infraCommand: Command) {
  const resourceCommand = infraCommand
    .command('resource')
    .description('Cloud resource management and inventory');

  // 1. list
  resourceCommand
    .command('list')
    .description('List cloud resources')
    .option('-t, --type <type>', 'Filter by resource type (e.g., ec2, rds, s3)')
    .option('-p, --provider <provider>', 'Filter by cloud provider: aws/azure/gcp/aliyun')
    .option('-e, --environment <env>', 'Filter by environment: production/staging/dev/test')
    .option('-s, --status <status>', 'Filter by status: running/stopped/terminated')
    .option('-a, --app-id <id>', 'Filter by associated application ID')
    .option('--search <keyword>', 'Search by resource name or ID')
    .option('--sort <field>', 'Sort field: name/type/cost/created-at (default: created-at)')
    .option('--order <asc|desc>', 'Sort order (default: desc)')
    .option('--page <num>', 'Page number (default: 1)')
    .option('--limit <num>', 'Items per page (default: 20)')
    .option('--json', 'JSON format output')
    .option('--csv', 'CSV format output')
    .action(async (options) => {
      try {
        const params: any = {
          pageNo: parseInt(options.page) || 1,
          pageSize: parseInt(options.limit) || 20,
        };

        if (options.type) params.resourceType = options.type;
        if (options.provider) params.cloudProvider = options.provider;
        if (options.environment) params.environment = options.environment;
        if (options.status) params.status = options.status;
        if (options.search) params.keyword = options.search;
        if (options.sort) params.sort = options.sort;
        if (options.order) params.order = options.order;

        const result = await apiClient.get('/api/infra/resources', params);

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else if (options.csv) {
          console.log('ID,资源ID,资源名称,资源类型,云提供商,环境,状态,成本');
          result.records?.forEach((res: any) => {
            console.log(
              `${res.id},${res.resourceId},"${res.resourceName}",${res.resourceType},${res.cloudProvider},${res.environment},${res.status},${res.monthlyCost}`
            );
          });
        } else {
          console.log(`云资源列表 (共${result.total}个):`);
          console.log('─'.repeat(100));
          result.records?.forEach((res: any) => {
            console.log(
              `${res.id.toString().padEnd(5)} ${res.resourceName.padEnd(25)} ${res.resourceType.padEnd(15)} ${res.cloudProvider.padEnd(10)} ${res.environment.padEnd(12)} ${res.status}`
            );
          });
        }

        if (result.total > params.pageSize) {
          console.log(`\n显示第 ${params.pageNo} 页，共 ${Math.ceil(result.total / params.pageSize)} 页`);
        }
      } catch (error) {
        console.error('✗ 获取资源列表失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // 2. get
  resourceCommand
    .command('get <resource-id>')
    .description('Get resource details')
    .option('--show-costs', 'Show cost history')
    .option('--show-metrics', 'Show performance metrics')
    .option('--show-apps', 'Show associated applications')
    .option('--json', 'JSON format output')
    .option('--yaml', 'YAML format output')
    .action(async (resourceId, options) => {
      try {
        const resource = await apiClient.get(`/api/infra/resources/${resourceId}`);

        if (options.json) {
          console.log(JSON.stringify(resource, null, 2));
        } else {
          console.log('资源详情:');
          console.log('─'.repeat(50));
          console.log(`ID: ${resource.id}`);
          console.log(`资源ID: ${resource.resourceId}`);
          console.log(`资源名称: ${resource.resourceName}`);
          console.log(`资源类型: ${resource.resourceType}`);
          console.log(`云提供商: ${resource.cloudProvider}`);
          console.log(`区域: ${resource.region}`);
          console.log(`环境: ${resource.environment}`);
          console.log(`状态: ${resource.status}`);
          console.log(`月成本: $${resource.monthlyCost}`);
          if (resource.tags) console.log(`标签: ${resource.tags}`);
          console.log(`创建时间: ${resource.createdAt}`);
        }

        if (options.showCosts) {
          try {
            const costHistory = await apiClient.get(`/api/infra/resources/${resourceId}/cost-history`);
            console.log('\n成本历史 (最近6个月):');
            console.log('─'.repeat(50));
            costHistory.records?.slice(0, 6).forEach((record: any) => {
              console.log(`${record.month}: $${record.cost?.toFixed(2) || '0.00'}`);
            });
          } catch (error) {
            console.warn('⚠ 无法获取成本历史');
          }
        }

        if (options.showMetrics) {
          try {
            const metrics = (await apiClient.get(`/api/infra/resources/${resourceId}/metrics`)) as any;
            console.log('\n性能指标:');
            console.log('─'.repeat(50));
            console.log(`CPU使用率: ${metrics?.cpuUsage || 'N/A'}%`);
            console.log(`内存使用率: ${metrics?.memoryUsage || 'N/A'}%`);
            console.log(`磁盘使用率: ${metrics?.diskUsage || 'N/A'}%`);
            console.log(`网络出入流量: ${metrics?.networkIO || 'N/A'} MB`);
          } catch (error) {
            console.warn('⚠ 无法获取性能指标');
          }
        }

        if (options.showApps) {
          try {
            const apps = (await apiClient.get(`/api/infra/resources/${resourceId}/apps`)) as any;
            console.log('\n关联应用:');
            console.log('─'.repeat(50));
            if (apps?.records && apps.records.length > 0) {
              apps.records.forEach((app: any) => {
                console.log(`• ${app.appName} (ID: ${app.appId})`);
              });
            } else {
              console.log('(未关联任何应用)');
            }
          } catch (error) {
            console.warn('⚠ 无法获取关联应用');
          }
        }
      } catch (error) {
        console.error('✗ 获取资源失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // 3. import
  resourceCommand
    .command('import')
    .description('Batch import resources from CSV/JSON')
    .option('-f, --file <path>', 'File path (required)')
    .option('--format <fmt>', 'File format: csv/json (default: csv)')
    .option('-p, --provider <provider>', 'Cloud provider: aws/azure/gcp/aliyun (required)')
    .option('--preview', 'Preview import content, do not actually import')
    .option('--skip-errors', 'Skip error rows, continue importing')
    .option('--update-existing', 'Update existing resources')
    .action(async (options) => {
      try {
        if (!options.file || !options.provider) {
          console.error('错误: --file 和 --provider 参数是必需的');
          process.exit(1);
        }

        const fs = require('fs');

        if (!fs.existsSync(options.file)) {
          console.error(`✗ 文件不存在: ${options.file}`);
          process.exit(1);
        }

        const format = options.format || 'csv';
        let resources = [];

        if (format === 'csv') {
          resources = parseCSV(options.file);
        } else if (format === 'json') {
          const content = fs.readFileSync(options.file, 'utf-8');
          resources = JSON.parse(content);
        }

        if (options.preview) {
          console.log(`预览导入内容（共${resources.length}行）:`);
          console.log('─'.repeat(80));
          resources.slice(0, 5).forEach((res, idx) => {
            console.log(`${idx + 1}. ${res.name || res.resourceName || '(未命名)'} (${res.type || res.resourceType})`);
          });
          if (resources.length > 5) {
            console.log(`... 还有 ${resources.length - 5} 行`);
          }
          return;
        }

        console.log(`开始导入 ${resources.length} 个资源...`);

        try {
          const payload = {
            resources,
            cloudProvider: options.provider,
            format,
            skipErrors: options.skipErrors,
            updateExisting: options.updateExisting,
          };

          const result = (await apiClient.post('/api/infra/resources/import', payload)) as any;

          console.log('─'.repeat(50));
          console.log(`✓ 导入完成`);
          console.log(`成功: ${result?.successCount || 0}`);
          console.log(`失败: ${result?.failureCount || 0}`);

          if (result?.errors && Array.isArray(result.errors) && result.errors.length > 0) {
            console.log('\n导入错误:');
            result.errors.slice(0, 5).forEach((error: any) => {
              console.log(`  行 ${error.row}: ${error.message}`);
            });
            if (result.errors.length > 5) {
              console.log(`  ... 还有 ${result.errors.length - 5} 个错误`);
            }
          }
        } catch (error) {
          console.error('✗ 导入失败:', error instanceof Error ? error.message : String(error));
          process.exit(1);
        }
      } catch (error) {
        console.error('✗ 导入失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // 4. export
  resourceCommand
    .command('export')
    .description('Export resource inventory')
    .option('-f, --file <path>', 'Export file path (default: resources.csv)')
    .option('--format <fmt>', 'Export format: csv/json/excel (default: csv)')
    .option('-t, --type <type>', 'Filter by resource type for export')
    .option('-p, --provider <provider>', 'Filter by cloud provider for export')
    .option('-e, --environment <env>', 'Filter by environment for export')
    .option('-a, --app-id <id>', 'Filter by application for export')
    .option('--include-costs', 'Include cost data')
    .option('--include-metrics', 'Include metrics data')
    .action(async (options) => {
      try {
        const fs = require('fs');

        const format = options.format || 'csv';
        const filePath = options.file || `resources.${format}`;

        const params: any = {
          pageNo: 1,
          pageSize: 10000,
        };

        if (options.type) params.resourceType = options.type;
        if (options.provider) params.cloudProvider = options.provider;
        if (options.environment) params.environment = options.environment;

        console.log(`正在导出资源清单到 ${filePath}...`);

        const result = (await apiClient.get('/api/infra/resources', params)) as any;
        const resources = result?.records || [];

        if (resources.length === 0) {
          console.warn('没有找到资源');
          return;
        }

        let content = '';

        if (format === 'csv') {
          content = '资源ID,资源名称,资源类型,云提供商,区域,环境,状态,月成本,创建时间\n';
          resources.forEach((res: any) => {
            const row = [
              res.resourceId,
              `"${res.resourceName}"`,
              res.resourceType,
              res.cloudProvider,
              res.region || '',
              res.environment,
              res.status,
              res.monthlyCost || 0,
              res.createdAt,
            ].join(',');
            content += row + '\n';
          });
        } else if (format === 'json') {
          content = JSON.stringify(resources, null, 2);
        }

        fs.writeFileSync(filePath, content, 'utf-8');
        console.log(`✓ 成功导出 ${resources.length} 个资源到 ${filePath}`);
      } catch (error) {
        console.error('✗ 导出失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  return resourceCommand;
}

// Helper function to parse CSV
function parseCSV(filePath: string): any[] {
  const fs = require('fs');
  const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter((l: string) => l.trim());
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h: string) => h.trim());
  const records = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map((v: string) => v.trim().replace(/^"|"$/g, ''));
    const record: any = {};
    headers.forEach((header: string, idx: number) => {
      record[header.toLowerCase()] = values[idx];
    });
    records.push(record);
  }

  return records;
}

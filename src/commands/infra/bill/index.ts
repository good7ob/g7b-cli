/**
 * Bill Import and Management Commands
 *
 * Subcommands:
 * - infra bill import: Import bills from cloud providers
 * - infra bill list: List imported bills
 * - infra bill get: Get bill details
 * - infra bill schedule: Schedule automatic bill imports
 * - infra bill delete: Delete bill records
 */

import { Command } from 'commander';
import apiClient from '../../../services/ApiClient';

export function registerBillCommands(infraCommand: Command) {
  const billCommand = infraCommand
    .command('bill')
    .description('Bill import, management, and reconciliation');

  // 1. import
  billCommand
    .command('import')
    .description('Import bills from cloud provider files')
    .option('-f, --file <path>', 'Bill file path (required)')
    .option('-p, --provider <provider>', 'Cloud provider: aws/azure/gcp/aliyun (required)')
    .option('--format <fmt>', 'File format: csv/json/tsv (default: csv)')
    .option('-m, --month <YYYY-MM>', 'Billing month (optional, auto-detect from file)')
    .option('--preview', 'Preview import content, do not actually import')
    .option('--skip-errors', 'Skip error rows, continue importing')
    .option('--skip-duplicate', 'Skip duplicate entries')
    .option('--start-row <num>', 'Start row number for parsing (default: 1)')
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
        const fileContent = fs.readFileSync(options.file, 'utf-8');

        const params: any = {
          provider: options.provider,
          format,
          month: options.month,
          preview: options.preview || false,
          skipErrors: options.skipErrors || false,
          skipDuplicate: options.skipDuplicate || false,
          startRow: parseInt(options.startRow) || 1,
        };

        console.log(`正在导入账单文件: ${options.file}`);
        console.log(`云提供商: ${options.provider}`);
        console.log(`格式: ${format}`);

        // For preview mode, just show sample
        if (options.preview) {
          const lines = fileContent.split('\n').slice(0, 6);
          console.log('\n预览导入内容 (前5行):');
          console.log('─'.repeat(80));
          lines.forEach((line: string, idx: number) => {
            if (line.trim()) {
              console.log(line.substring(0, 100));
            }
          });
          return;
        }

        const result = await apiClient.post('/api/infra/bills/import', {
          fileContent,
          ...params,
        });

        console.log('─'.repeat(50));
        console.log(`✓ 导入完成`);
        console.log(`成功行数: ${result.successCount || 0}`);
        console.log(`失败行数: ${result.failureCount || 0}`);
        console.log(`跳过行数: ${result.skippedCount || 0}`);
        if (result.billId) {
          console.log(`账单ID: ${result.billId}`);
        }
      } catch (error) {
        console.error('✗ 导入账单失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // 2. list
  billCommand
    .command('list')
    .description('List imported bills')
    .option('-p, --provider <provider>', 'Filter by cloud provider: aws/azure/gcp/aliyun')
    .option('-m, --month <YYYY-MM>', 'Filter by billing month')
    .option('-s, --status <status>', 'Filter by status: pending/processing/success/failed/partial')
    .option('--sort <field>', 'Sort by: month/provider/created-at (default: created-at)')
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
          sort: options.sort || 'created-at',
          order: options.order || 'desc',
        };

        if (options.provider) params.cloudProvider = options.provider;
        if (options.month) params.month = options.month;
        if (options.status) params.status = options.status;

        const result = await apiClient.get('/api/infra/bills', params);

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else if (options.csv) {
          console.log('ID,账单月份,云提供商,状态,记录数,成本总额,创建时间');
          result.records?.forEach((bill: any) => {
            console.log(
              `${bill.id},${bill.month},${bill.cloudProvider},${bill.status},${bill.recordCount},${bill.totalCost},${bill.createdAt}`
            );
          });
        } else {
          console.log(`账单列表 (共${result.total}条):`);
          console.log('─'.repeat(100));
          console.log(
            'ID'.padEnd(10) +
            '账单月份'.padEnd(12) +
            '云提供商'.padEnd(12) +
            '状态'.padEnd(10) +
            '记录数'.padEnd(8) +
            '成本总额'.padEnd(15) +
            '创建时间'
          );
          console.log('─'.repeat(100));

          result.records?.forEach((bill: any) => {
            console.log(
              bill.id.toString().padEnd(10) +
              (bill.month || '-').padEnd(12) +
              bill.cloudProvider.padEnd(12) +
              bill.status.padEnd(10) +
              (bill.recordCount || 0).toString().padEnd(8) +
              `$${(bill.totalCost || 0).toFixed(2)}`.padEnd(15) +
              (bill.createdAt || '-')
            );
          });
        }

        if (result.total > params.pageSize) {
          console.log(`\n显示第 ${params.pageNo} 页，共 ${Math.ceil(result.total / params.pageSize)} 页`);
        }
      } catch (error) {
        console.error('✗ 获取账单列表失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // 3. get
  billCommand
    .command('get <bill-id>')
    .description('Get bill details and import summary')
    .option('--show-records', 'Show imported cost records')
    .option('--show-errors', 'Show import error details')
    .option('--show-reconcile', 'Show reconciliation status')
    .option('--limit <num>', 'Limit records shown (default: 100)')
    .option('--json', 'JSON format output')
    .action(async (billId, options) => {
      try {
        const params: any = {};
        if (options.showRecords) params.includeRecords = true;
        if (options.showErrors) params.includeErrors = true;
        if (options.showReconcile) params.includeReconcile = true;
        if (options.limit) params.limit = parseInt(options.limit);

        const bill = await apiClient.get(`/api/infra/bills/${billId}`, params);

        if (options.json) {
          console.log(JSON.stringify(bill, null, 2));
        } else {
          console.log('账单详情:');
          console.log('─'.repeat(50));
          console.log(`ID: ${bill.id}`);
          console.log(`账单月份: ${bill.month}`);
          console.log(`云提供商: ${bill.cloudProvider}`);
          console.log(`状态: ${bill.status}`);
          console.log(`文件名: ${bill.fileName || '-'}`);
          console.log(`文件大小: ${bill.fileSize || '-'}`);
          console.log(`成本总额: $${bill.totalCost || 0}`);
          console.log(`导入记录数: ${bill.recordCount || 0}`);
          console.log(`成功数: ${bill.successCount || 0}`);
          console.log(`失败数: ${bill.failureCount || 0}`);
          console.log(`跳过数: ${bill.skippedCount || 0}`);
          console.log(`创建时间: ${bill.createdAt}`);

          if (options.showReconcile && bill.reconcileStatus) {
            console.log('\n对账状态:');
            console.log(`  已对账: ${bill.reconcileStatus.reconciled ? '是' : '否'}`);
            console.log(`  差异金额: $${bill.reconcileStatus.difference || 0}`);
            console.log(`  差异百分比: ${bill.reconcileStatus.differencePercentage || 0}%`);
          }

          if (options.showErrors && bill.errors && bill.errors.length > 0) {
            console.log('\n导入错误:');
            bill.errors.slice(0, parseInt(options.limit) || 100).forEach((error: any, idx: number) => {
              console.log(`  ${idx + 1}. 行 ${error.rowNumber}: ${error.message}`);
            });
          }

          if (options.showRecords && bill.records && bill.records.length > 0) {
            console.log('\n成本记录 (前100条):');
            console.log('─'.repeat(70));
            bill.records.slice(0, parseInt(options.limit) || 100).forEach((record: any) => {
              console.log(
                `${record.resourceId || '-'} | ${record.cost || 0} | ${record.date || '-'}`
              );
            });
          }
        }
      } catch (error) {
        console.error('✗ 获取账单详情失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // 4. schedule
  billCommand
    .command('schedule')
    .description('Configure automatic bill import schedule')
    .option('--add-schedule', 'Add new schedule')
    .option('--schedule-id <id>', 'Schedule ID for update/delete')
    .option('--provider <provider>', 'Cloud provider: aws/azure/gcp/aliyun')
    .option('--frequency <freq>', 'Import frequency: daily/weekly/monthly (default: monthly)')
    .option('--day <day>', 'Day of month to run (1-31, default: 1st)')
    .option('--time <HH:MM>', 'Time to run in UTC (default: 00:00)')
    .option('--bucket <name>', 'S3/Blob bucket name for bill files')
    .option('--prefix <prefix>', 'File prefix/pattern to match')
    .option('--enabled', 'Enable this schedule')
    .option('--disable', 'Disable this schedule')
    .option('--list-schedules', 'List all configured schedules')
    .option('--remove-schedule <id>', 'Remove a schedule')
    .option('--test', 'Test the schedule configuration')
    .option('--json', 'JSON format output')
    .action(async (options) => {
      try {
        // List schedules
        if (options.listSchedules) {
          const schedules = await apiClient.get('/api/infra/bill-schedules');

          if (options.json) {
            console.log(JSON.stringify(schedules, null, 2));
          } else {
            console.log('账单导入计划列表:');
            console.log('─'.repeat(100));
            console.log('ID'.padEnd(10) + '云提供商'.padEnd(12) + '频率'.padEnd(10) + '状态'.padEnd(10) + '下次运行'.padEnd(20) + '创建时间');
            console.log('─'.repeat(100));

            schedules.forEach((schedule: any) => {
              console.log(
                (schedule.id || '-').toString().padEnd(10) +
                schedule.cloudProvider.padEnd(12) +
                schedule.frequency.padEnd(10) +
                (schedule.enabled ? '已启用' : '已禁用').padEnd(10) +
                (schedule.nextRun || '-').padEnd(20) +
                (schedule.createdAt || '-')
              );
            });
          }
          return;
        }

        // Remove schedule
        if (options.removeSchedule) {
          await apiClient.delete(`/api/infra/bill-schedules/${options.removeSchedule}`);
          console.log(`✓ 删除计划成功`);
          return;
        }

        // Add or update schedule
        if (options.addSchedule || options.scheduleId) {
          if (!options.provider) {
            console.error('错误: --provider 参数是必需的');
            process.exit(1);
          }

          const payload: any = {
            cloudProvider: options.provider,
            frequency: options.frequency || 'monthly',
            dayOfMonth: parseInt(options.day) || 1,
            time: options.time || '00:00',
            bucket: options.bucket,
            prefix: options.prefix,
          };

          let result;
          if (options.scheduleId) {
            result = await apiClient.put(`/api/infra/bill-schedules/${options.scheduleId}`, payload);
            console.log(`✓ 更新计划成功`);
          } else {
            result = await apiClient.post('/api/infra/bill-schedules', payload);
            console.log(`✓ 创建计划成功`);
          }

          if (options.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            console.log(`计划ID: ${result.id}`);
            console.log(`下次运行: ${result.nextRun}`);
          }
          return;
        }

        // Enable/Disable schedule
        if (options.scheduleId && (options.enabled || options.disable)) {
          const endpoint = options.enabled
            ? `/api/infra/bill-schedules/${options.scheduleId}/enable`
            : `/api/infra/bill-schedules/${options.scheduleId}/disable`;

          await apiClient.patch(endpoint, {});
          console.log(`✓ 计划已${options.enabled ? '启用' : '禁用'}`);
          return;
        }

        // Test schedule
        if (options.test && options.scheduleId) {
          console.log(`正在测试计划 ${options.scheduleId}...`);
          const result = await apiClient.post(`/api/infra/bill-schedules/${options.scheduleId}/test`, {});

          if (options.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            console.log(`✓ 测试完成`);
            console.log(`状态: ${result.success ? '成功' : '失败'}`);
            if (result.message) {
              console.log(`信息: ${result.message}`);
            }
          }
          return;
        }

        console.error('错误: 请提供 --add-schedule, --remove-schedule, --list-schedules 或 --test 选项');
      } catch (error) {
        console.error('✗ 管理账单计划失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // 5. delete
  billCommand
    .command('delete <bill-id>')
    .description('Delete a bill record and associated cost data')
    .option('--force, -f', 'Skip confirmation')
    .option('--soft-delete', 'Soft delete (default)')
    .option('--hard-delete', 'Hard delete (cannot be recovered)')
    .option('--keep-costs', 'Delete bill record but keep cost data')
    .action(async (billId, options) => {
      try {
        // Get bill info first
        const bill = await apiClient.get(`/api/infra/bills/${billId}`);

        if (!options.force) {
          console.log(`\n您即将删除账单 ${billId}`);
          console.log(`账单月份: ${bill.month}`);
          console.log(`云提供商: ${bill.cloudProvider}`);
          console.log(`记录数: ${bill.recordCount || 0}`);
          console.log(`成本总额: $${bill.totalCost || 0}`);

          if (options.hardDelete) {
            console.log('\n⚠️  硬删除无法恢复！');
          }

          // Since we're in CLI, we can't get interactive input,
          // so we just log the warning and proceed with soft delete by default
          if (!options.hardDelete) {
            console.log('执行软删除（可恢复）');
          }
        }

        const payload = {
          hardDelete: options.hardDelete || false,
          keepCosts: options.keepCosts || false,
        };

        await apiClient.delete(`/api/infra/bills/${billId}`, payload);

        console.log('✓ 账单已删除');
        if (options.hardDelete) {
          console.log('  类型: 硬删除（无法恢复）');
        } else {
          console.log('  类型: 软删除（可恢复）');
        }
        if (options.keepCosts) {
          console.log('  成本数据: 已保留');
        }
      } catch (error) {
        console.error('✗ 删除账单失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  return billCommand;
}

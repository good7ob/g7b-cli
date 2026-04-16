/**
 * Cost Analysis and Monitoring Commands
 *
 * Subcommands:
 * - infra cost overview: Cost summary for a month
 * - infra cost app: Cost breakdown by application
 * - infra cost env: Cost breakdown by environment
 * - infra cost type: Cost breakdown by resource type
 * - infra cost provider: Cost breakdown by cloud provider
 * - infra cost trend: Cost trends over time
 * - infra cost waste: Identify waste and low-utilization resources
 * - infra cost reconcile: Reconcile costs against bills
 * - infra cost export: Export cost report
 * - infra cost forecast: Forecast monthly costs based on trends
 */

import { Command } from 'commander';
import apiClient from '../../../services/ApiClient';

export function registerCostCommands(infraCommand: Command) {
  const costCommand = infraCommand
    .command('cost')
    .description('Cost analysis, monitoring, and reporting');

  // 1. overview
  costCommand
    .command('overview')
    .description('Get cost overview for a specific month')
    .option('-m, --month <YYYY-MM>', 'Month to analyze (default: current month)')
    .option('--compare-last', 'Compare with previous month')
    .option('--currency <currency>', 'Display currency: USD/CNY (default: USD)')
    .option('--json', 'JSON format output')
    .action(async (options) => {
      try {
        const month = options.month || new Date().toISOString().slice(0, 7);

        const params: any = {
          month,
          compareLast: options.compareLast || false,
        };

        const overview = await apiClient.get('/api/infra/cost/overview', params);

        if (options.json) {
          console.log(JSON.stringify(overview, null, 2));
        } else {
          console.log(`成本概览 - ${month}`);
          console.log('─'.repeat(50));
          console.log(`本月总成本: $${overview.currentMonth?.toFixed(2) || '0.00'}`);
          if (options.compareLast) {
            console.log(`上月成本:  $${overview.previousMonth?.toFixed(2) || '0.00'}`);
            console.log(`环比变化:  ${overview.monthChange?.toFixed(2) || '0'}%`);
          }
          console.log(`浪费成本:  $${overview.wasteCost?.toFixed(2) || '0.00'}`);
          console.log(`预算使用:  ${overview.budgetUsageRate?.toFixed(2) || '0'}%`);
        }
      } catch (error) {
        console.error('✗ 获取成本概览失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // 2. app
  costCommand
    .command('app')
    .description('Cost breakdown by application')
    .option('-m, --month <YYYY-MM>', 'Month to analyze (default: current month)')
    .option('--limit <num>', 'Top N applications (default: 10)')
    .option('--include-breakdown', 'Include resource type breakdown per app')
    .option('--sort <field>', 'Sort by: cost/name/resource-count (default: cost)')
    .option('--order <asc|desc>', 'Sort order (default: desc)')
    .option('--json', 'JSON format output')
    .action(async (options) => {
      try {
        const month = options.month || new Date().toISOString().slice(0, 7);
        const limit = parseInt(options.limit) || 10;

        const params = {
          month,
          limit,
          includeBreakdown: options.includeBreakdown || false,
          sort: options.sort || 'cost',
          order: options.order || 'desc',
        };

        const data = await apiClient.get('/api/infra/cost/by-app', params);

        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          console.log(`应用成本分析 - ${month} (Top ${limit})`);
          console.log('─'.repeat(70));
          console.log('应用名称'.padEnd(25) + '成本(USD)'.padEnd(15) + '资源数'.padEnd(10) + '占比');
          console.log('─'.repeat(70));

          if (data.apps && data.apps.length > 0) {
            data.apps.forEach((app: any) => {
              const percentage = data.totalCost > 0 ? ((app.cost / data.totalCost) * 100).toFixed(1) : '0';
              console.log(
                app.name.padEnd(25) +
                  `$${app.cost.toFixed(2)}`.padEnd(15) +
                  (app.resourceCount || 0).toString().padEnd(10) +
                  percentage + '%'
              );
            });
          }

          console.log('─'.repeat(70));
          console.log(`总成本: $${data.totalCost?.toFixed(2) || '0.00'}`);
        }
      } catch (error) {
        console.error('✗ 获取应用成本失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // 3. env
  costCommand
    .command('env')
    .description('Cost breakdown by environment')
    .option('-m, --month <YYYY-MM>', 'Month to analyze (default: current month)')
    .option('--compare-prod', 'Compare all environments with production')
    .option('--json', 'JSON format output')
    .action(async (options) => {
      try {
        const month = options.month || new Date().toISOString().slice(0, 7);

        const params = {
          month,
          compareProduction: options.compareProd || false,
        };

        const data = await apiClient.get('/api/infra/cost/by-env', params);

        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          console.log(`环境成本分析 - ${month}`);
          console.log('─'.repeat(60));
          console.log('环境'.padEnd(15) + '成本(USD)'.padEnd(20) + '占比');
          console.log('─'.repeat(60));

          if (data.environments && data.environments.length > 0) {
            data.environments.forEach((env: any) => {
              const percentage = data.totalCost > 0 ? ((env.cost / data.totalCost) * 100).toFixed(1) : '0';
              console.log(
                env.name.padEnd(15) +
                  `$${env.cost.toFixed(2)}`.padEnd(20) +
                  percentage + '%'
              );
            });
          }

          console.log('─'.repeat(60));
          console.log(`总成本: $${data.totalCost?.toFixed(2) || '0.00'}`);
        }
      } catch (error) {
        console.error('✗ 获取环境成本失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // 4. type
  costCommand
    .command('type')
    .description('Cost breakdown by resource type')
    .option('-m, --month <YYYY-MM>', 'Month to analyze (default: current month)')
    .option('-p, --provider <provider>', 'Filter by cloud provider: aws/azure/gcp/aliyun')
    .option('--limit <num>', 'Top N resource types (default: 10)')
    .option('--json', 'JSON format output')
    .action(async (options) => {
      try {
        const month = options.month || new Date().toISOString().slice(0, 7);
        const limit = parseInt(options.limit) || 10;

        const params: any = {
          month,
          limit,
        };

        if (options.provider) params.cloudProvider = options.provider;

        const data = await apiClient.get('/api/infra/cost/by-type', params);

        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          console.log(`资源类型成本分析 - ${month} (Top ${limit})`);
          console.log('─'.repeat(70));
          console.log('资源类型'.padEnd(25) + '成本(USD)'.padEnd(15) + '资源数'.padEnd(10) + '占比');
          console.log('─'.repeat(70));

          if (data.types && data.types.length > 0) {
            data.types.forEach((type: any) => {
              const percentage = data.totalCost > 0 ? ((type.cost / data.totalCost) * 100).toFixed(1) : '0';
              console.log(
                type.name.padEnd(25) +
                  `$${type.cost.toFixed(2)}`.padEnd(15) +
                  (type.resourceCount || 0).toString().padEnd(10) +
                  percentage + '%'
              );
            });
          }

          console.log('─'.repeat(70));
          console.log(`总成本: $${data.totalCost?.toFixed(2) || '0.00'}`);
        }
      } catch (error) {
        console.error('✗ 获取资源类型成本失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // 5. provider
  costCommand
    .command('provider')
    .description('Cost breakdown by cloud provider')
    .option('-m, --month <YYYY-MM>', 'Month to analyze (default: current month)')
    .option('--json', 'JSON format output')
    .action(async (options) => {
      try {
        const month = options.month || new Date().toISOString().slice(0, 7);

        const params = {
          month,
        };

        const data = await apiClient.get('/api/infra/cost/by-provider', params);

        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          console.log(`云提供商成本分析 - ${month}`);
          console.log('─'.repeat(60));
          console.log('提供商'.padEnd(15) + '成本(USD)'.padEnd(20) + '占比');
          console.log('─'.repeat(60));

          if (data.providers && data.providers.length > 0) {
            data.providers.forEach((provider: any) => {
              const percentage = data.totalCost > 0 ? ((provider.cost / data.totalCost) * 100).toFixed(1) : '0';
              console.log(
                provider.name.padEnd(15) +
                  `$${provider.cost.toFixed(2)}`.padEnd(20) +
                  percentage + '%'
              );
            });
          }

          console.log('─'.repeat(60));
          console.log(`总成本: $${data.totalCost?.toFixed(2) || '0.00'}`);
        }
      } catch (error) {
        console.error('✗ 获取云提供商成本失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // 6. trend
  costCommand
    .command('trend')
    .description('Cost trends over time')
    .option('--months <num>', 'Number of months to analyze (default: 12)')
    .option('--dimension <dim>', 'Trend dimension: total/app/env/type/provider (default: total)')
    .option('--dimension-value <value>', 'Specific dimension value to track (e.g., app_id, environment name)')
    .option('--json', 'JSON format output')
    .action(async (options) => {
      try {
        const months = parseInt(options.months) || 12;
        const dimension = options.dimension || 'total';

        const params = {
          months,
          dimension,
          dimensionValue: options.dimensionValue,
        };

        const data = await apiClient.get('/api/infra/cost/trend', params);

        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          console.log(`成本趋势 - 最近 ${months} 个月`);
          console.log('─'.repeat(50));

          if (data.trends && data.trends.length > 0) {
            // Find max cost for scaling
            const maxCost = Math.max(...data.trends.map((t: any) => t.cost || 0));
            const scale = Math.ceil(maxCost / 20);

            data.trends.forEach((trend: any) => {
              const barLength = Math.round((trend.cost || 0) / scale);
              const bar = '█'.repeat(barLength);
              console.log(
                `${trend.month} │ ${bar} $${(trend.cost || 0).toFixed(2)}`
              );
            });
          }

          console.log('─'.repeat(50));
          console.log(`平均成本: $${data.averageCost?.toFixed(2) || '0.00'}`);
          console.log(`最高成本: $${data.maxCost?.toFixed(2) || '0.00'}`);
          console.log(`增长率: ${data.growthRate?.toFixed(2) || '0'}%`);
        }
      } catch (error) {
        console.error('✗ 获取成本趋势失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // 7. waste
  costCommand
    .command('waste')
    .description('Identify waste and low-utilization resources')
    .option('-m, --month <YYYY-MM>', 'Month to analyze (default: current month)')
    .option('--dimension <dim>', 'Waste analysis by: resource/app/env (default: resource)')
    .option('--min-waste <amount>', 'Minimum waste amount in USD (default: 100)')
    .option('--limit <num>', 'Top N waste items (default: 20)')
    .option('--json', 'JSON format output')
    .action(async (options) => {
      try {
        const month = options.month || new Date().toISOString().slice(0, 7);
        const dimension = options.dimension || 'resource';
        const minWaste = parseFloat(options.minWaste) || 100;
        const limit = parseInt(options.limit) || 20;

        const params = {
          month,
          dimension,
          minWaste,
          limit,
        };

        const data = await apiClient.get('/api/infra/cost/waste', params);

        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          console.log(`浪费识别 - ${month} (${dimension}维度)`);
          console.log('─'.repeat(80));
          console.log('资源名称'.padEnd(30) + '浪费成本(USD)'.padEnd(20) + '原因'.padEnd(20));
          console.log('─'.repeat(80));

          if (data.wasteItems && data.wasteItems.length > 0) {
            data.wasteItems.slice(0, limit).forEach((item: any) => {
              const reason = item.reason || '低利用率';
              console.log(
                item.name.padEnd(30) +
                  `$${item.wasteCost.toFixed(2)}`.padEnd(20) +
                  reason.padEnd(20)
              );
            });
          }

          console.log('─'.repeat(80));
          console.log(`总浪费: $${data.totalWaste?.toFixed(2) || '0.00'}`);
          console.log(`浪费占比: ${data.wastePercentage?.toFixed(2) || '0'}%`);
          console.log(`优化空间: $${data.optimizationPotential?.toFixed(2) || '0.00'}`);
        }
      } catch (error) {
        console.error('✗ 获取浪费信息失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // 8. reconcile
  costCommand
    .command('reconcile')
    .description('Reconcile costs against original bills')
    .option('-m, --month <YYYY-MM>', 'Month to reconcile (default: current month)')
    .option('-p, --provider <provider>', 'Cloud provider: aws/azure/gcp/aliyun')
    .option('--tolerance <percentage>', 'Tolerance percentage (default: 1%)')
    .option('--verbose', 'Show detailed differences')
    .option('--json', 'JSON format output')
    .action(async (options) => {
      try {
        const month = options.month || new Date().toISOString().slice(0, 7);
        const tolerance = parseFloat(options.tolerance) || 1;

        const params: any = {
          month,
          tolerance,
          verbose: options.verbose || false,
        };

        if (options.provider) params.cloudProvider = options.provider;

        const data = await apiClient.get('/api/infra/cost/reconcile', params);

        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          console.log(`成本对账报告 - ${month}`);
          console.log('─'.repeat(80));
          console.log(`计费系统总额: $${data.billingTotal?.toFixed(2) || '0.00'}`);
          console.log(`追踪系统总额: $${data.trackedTotal?.toFixed(2) || '0.00'}`);
          console.log(`差异金额: $${data.difference?.toFixed(2) || '0.00'}`);
          console.log(`差异百分比: ${data.differencePercentage?.toFixed(2) || '0'}%`);
          console.log(`对账状态: ${data.reconciled ? '✓ 已对账' : '✗ 未对账'}`);
          console.log('─'.repeat(80));

          if (options.verbose && data.details && data.details.length > 0) {
            console.log('\n详细差异:');
            data.details.forEach((detail: any) => {
              console.log(
                `  ${detail.category}: $${detail.difference?.toFixed(2)} (${detail.differencePercentage?.toFixed(1)}%)`
              );
            });
          }
        }
      } catch (error) {
        console.error('✗ 成本对账失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // 9. export
  costCommand
    .command('export')
    .description('Export cost report')
    .option('-m, --month <YYYY-MM>', 'Month to export (default: current month)')
    .option('-f, --file <path>', 'Export file path (default: cost-report.pdf)')
    .option('--format <fmt>', 'Export format: pdf/excel/csv (default: pdf)')
    .option('--include-trends', 'Include trend analysis')
    .option('--include-waste', 'Include waste analysis')
    .option('--include-recommendations', 'Include cost optimization recommendations')
    .action(async (options) => {
      try {
        const month = options.month || new Date().toISOString().slice(0, 7);
        const format = options.format || 'pdf';
        const fileName = options.file || `cost-report-${month}.${format}`;

        const params = {
          month,
          format,
          includeTrends: options.includeTrends || false,
          includeWaste: options.includeWaste || false,
          includeRecommendations: options.includeRecommendations || false,
        };

        console.log(`正在生成 ${format.toUpperCase()} 成本报告...`);
        const result = await apiClient.get('/api/infra/cost/export', params);

        // Note: In production, this would handle file download
        // For now, we just log the result
        console.log(`✓ 报告已生成`);
        console.log(`文件: ${fileName}`);
        console.log(`大小: ${result.fileSize || 'N/A'}`);
        console.log(`格式: ${format.toUpperCase()}`);
        if (result.url) {
          console.log(`下载链接: ${result.url}`);
        }
      } catch (error) {
        console.error('✗ 导出成本报告失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // 10. forecast
  costCommand
    .command('forecast')
    .description('Forecast monthly costs based on trends')
    .option('--months-ahead <num>', 'Number of months to forecast (default: 3)')
    .option('--confidence <percentage>', 'Confidence level: 80/90/95 (default: 90)')
    .option('--dimension <dim>', 'Forecast by: total/app/env/type (default: total)')
    .option('--json', 'JSON format output')
    .action(async (options) => {
      try {
        const monthsAhead = parseInt(options.monthsAhead) || 3;
        const confidence = parseInt(options.confidence) || 90;
        const dimension = options.dimension || 'total';

        const params = {
          monthsAhead,
          confidence,
          dimension,
        };

        const data = await apiClient.get('/api/infra/cost/forecast', params);

        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          console.log(`成本预测 - 未来 ${monthsAhead} 个月 (${dimension}维度, ${confidence}% 置信度)`);
          console.log('─'.repeat(70));
          console.log('月份'.padEnd(15) + '预测成本(USD)'.padEnd(20) + '置信区间');
          console.log('─'.repeat(70));

          if (data.forecasts && data.forecasts.length > 0) {
            data.forecasts.forEach((forecast: any) => {
              const lower = forecast.lowerBound?.toFixed(2) || '0.00';
              const upper = forecast.upperBound?.toFixed(2) || '0.00';
              console.log(
                forecast.month.padEnd(15) +
                  `$${forecast.cost.toFixed(2)}`.padEnd(20) +
                  `$${lower} - $${upper}`
              );
            });
          }

          console.log('─'.repeat(70));
          console.log(`预测增长率: ${data.growthRate?.toFixed(2) || '0'}%`);
          console.log(`预测总成本: $${data.totalForecast?.toFixed(2) || '0.00'}`);
          console.log(`风险评级: ${data.riskLevel || '中'}`);

          if (data.recommendations && data.recommendations.length > 0) {
            console.log('\n优化建议:');
            data.recommendations.forEach((rec: any, idx: number) => {
              console.log(`  ${idx + 1}. ${rec}`);
            });
          }
        }
      } catch (error) {
        console.error('✗ 获取成本预测失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  return costCommand;
}

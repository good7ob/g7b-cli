import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { extractRecords } from '../../utils/extractRecords';
import { registerMemberCommands } from './members';
import { registerInvitationCommands } from './invitations';
import { registerProductCommands } from './products';

export function registerOrgCommands(program: Command) {
  const orgCommand = program
    .command('org')
    .description('Organization management — members, invitations, products, subscriptions');

  // ── Core Org CRUD ──────────────────────────────────────────────

  orgCommand
    .command('list')
    .description('List my organizations')
    .option('-p, --page <num>', 'Page number', '1')
    .option('-l, --limit <num>', 'Items per page', '20')
    .option('--json', 'Output as JSON')
    .option('--csv', 'Output as CSV')
    .action(async (options) => {
      try {
        const params = {
          page: parseInt(options.page) || 1,
          pageSize: parseInt(options.limit) || 20,
        };
        const result = await apiClient.get('/api/v1/orgs', params);
        // fix: #4 https://github.com/good7ob/g7b-cli/issues/4
        const records = extractRecords(result);

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        if (options.csv) {
          console.log('ID,Name,Slug,Tier,Members,Products,CreatedAt');
          records.forEach((o: any) => {
            console.log(`${o.id},${o.name},${o.slug || ''},${o.subscriptionTier || ''},${o.memberCount || 0},${o.productCount || 0},${o.createdAt || ''}`);
          });
          return;
        }

        if (!records.length) {
          console.log('No organizations found.');
          return;
        }

        console.log('\n我的组织');
        console.log('─'.repeat(85));
        console.log(
          'ID'.padEnd(8) +
          '组织名称'.padEnd(25) +
          'Slug'.padEnd(18) +
          '订阅套餐'.padEnd(15) +
          '成员数'.padEnd(8) +
          '产品数'
        );
        console.log('─'.repeat(85));
        records.forEach((o: any) => {
          console.log(
            String(o.id).padEnd(8) +
            (o.name || '').substring(0, 23).padEnd(25) +
            (o.slug || '-').padEnd(18) +
            (o.subscriptionTier || '-').padEnd(15) +
            String(o.memberCount || 0).padEnd(8) +
            String(o.productCount || 0)
          );
        });
        console.log('─'.repeat(85));
      } catch (error) {
        console.error('✗ 获取组织列表失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  orgCommand
    .command('get <org-id>')
    .description('Get organization details')
    .option('--json', 'Output as JSON')
    .action(async (orgId, options) => {
      try {
        const org = await apiClient.get(`/api/v1/orgs/${orgId}`);
        if (options.json) {
          console.log(JSON.stringify(org, null, 2));
          return;
        }
        console.log('\n组织详情');
        console.log('─'.repeat(55));
        console.log(`ID:       ${org.id}`);
        console.log(`名称:     ${org.name}`);
        console.log(`Slug:     ${org.slug || '-'}`);
        console.log(`描述:     ${org.description || '-'}`);
        console.log(`订阅套餐: ${org.subscriptionTier || '-'}`);
        console.log(`成员数:   ${org.memberCount || 0}`);
        console.log(`产品数:   ${org.productCount || 0}`);
        console.log(`创建时间: ${org.createdAt || '-'}`);
        console.log('─'.repeat(55));
      } catch (error) {
        console.error('✗ 获取组织详情失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  orgCommand
    .command('create')
    .description('Create a new organization')
    .requiredOption('--name <name>', 'Organization name')
    .option('--slug <slug>', 'URL-friendly identifier')
    .option('--description <desc>', 'Organization description')
    .option('--logo-url <url>', 'Logo image URL')
    .option('--tier <tier>', 'Subscription tier (basic|professional|enterprise)', 'basic')
    .option('--json', 'Output result as JSON')
    .action(async (options) => {
      try {
        const body: any = { name: options.name, subscriptionTier: options.tier };
        if (options.slug) body.slug = options.slug;
        if (options.description) body.description = options.description;
        if (options.logoUrl) body.logoUrl = options.logoUrl;

        const org = await apiClient.post('/api/v1/orgs', body);
        if (options.json) {
          console.log(JSON.stringify(org, null, 2));
          return;
        }
        console.log(`✓ 组织已创建: [${org?.id || ''}] ${options.name}`);
      } catch (error) {
        console.error('✗ 创建组织失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  orgCommand
    .command('update <org-id>')
    .description('Update organization information')
    .option('--name <name>', 'Organization name')
    .option('--description <desc>', 'Organization description')
    .option('--logo-url <url>', 'Logo image URL')
    .action(async (orgId, options) => {
      try {
        const body: any = {};
        if (options.name) body.name = options.name;
        if (options.description) body.description = options.description;
        if (options.logoUrl) body.logoUrl = options.logoUrl;

        await apiClient.put(`/api/v1/orgs/${orgId}`, body);
        console.log(`✓ 组织已更新: ${orgId}`);
      } catch (error) {
        console.error('✗ 更新组织失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  orgCommand
    .command('delete <org-id>')
    .description('Dissolve (delete) an organization')
    .option('-f, --force', 'Skip confirmation')
    .action(async (orgId, options) => {
      try {
        if (!options.force) {
          console.log(`⚠ 即将解散组织 ${orgId}，此操作不可撤销！使用 -f/--force 确认`);
          process.exit(0);
        }
        await apiClient.delete(`/api/v1/orgs/${orgId}?force=true`);
        console.log(`✓ 组织已解散: ${orgId}`);
      } catch (error) {
        console.error('✗ 解散组织失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // ── Subscription ───────────────────────────────────────────────

  orgCommand
    .command('subscription <org-id>')
    .description('Get organization subscription and quota info')
    .option('--json', 'Output as JSON')
    .action(async (orgId, options) => {
      try {
        const sub = await apiClient.get(`/api/v1/orgs/${orgId}/subscription`);
        if (options.json) {
          console.log(JSON.stringify(sub, null, 2));
          return;
        }
        console.log(`\n订阅信息 — 组织 ${orgId}`);
        console.log('─'.repeat(50));
        console.log(`套餐:       ${sub.tier || sub.subscriptionTier || '-'}`);
        console.log(`到期时间:   ${sub.expiresAt || '-'}`);
        console.log(`成员配额:   ${sub.quota?.maxMembers || '-'}`);
        console.log(`产品配额:   ${sub.quota?.maxProducts || '-'}`);
        console.log(`已用成员:   ${sub.usage?.members || 0}`);
        console.log(`已用产品:   ${sub.usage?.products || 0}`);
        console.log('─'.repeat(50));
      } catch (error) {
        console.error('✗ 获取订阅信息失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  orgCommand
    .command('upgrade <org-id>')
    .description('Upgrade organization subscription tier')
    .requiredOption('--tier <tier>', 'Target tier (professional|enterprise)')
    .action(async (orgId, options) => {
      try {
        await apiClient.post(`/api/v1/orgs/${orgId}/subscription/upgrade`, {
          targetTier: options.tier,
        });
        console.log(`✓ 升级请求已提交: 组织 ${orgId} → ${options.tier}`);
      } catch (error) {
        console.error('✗ 升级订阅失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // ── Sub-command groups ─────────────────────────────────────────

  registerMemberCommands(orgCommand);
  registerInvitationCommands(orgCommand);
  registerProductCommands(orgCommand);

  return orgCommand;
}

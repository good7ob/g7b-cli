import { Command } from 'commander';
import apiClient from '../../../services/ApiClient';
import { extractRecords } from '../../../utils/extractRecords';

export function registerInvitationCommands(orgCommand: Command) {
  // list invitations for an org
  orgCommand
    .command('invitations <org-id>')
    .description('List pending invitations for an organization')
    .option('--status <status>', 'Filter by status (pending|accepted|declined|expired|revoked)')
    .option('-p, --page <num>', 'Page number', '1')
    .option('-l, --limit <num>', 'Items per page', '20')
    .option('--json', 'Output as JSON')
    .action(async (orgId, options) => {
      try {
        const params: any = {
          page: parseInt(options.page) || 1,
          pageSize: parseInt(options.limit) || 20,
        };
        if (options.status) params.status = options.status;

        const result = await apiClient.get(`/api/v1/orgs/${orgId}/invitations`, params);
        // fix: #4 https://github.com/good7ob/g7b-cli/issues/4
        const records = extractRecords(result);

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        if (!records.length) {
          console.log('No invitations found.');
          return;
        }

        console.log(`\n邀请列表 — 组织 ${orgId}`);
        console.log('─'.repeat(85));
        console.log('ID'.padEnd(10) + 'Email'.padEnd(28) + '角色'.padEnd(10) + '状态'.padEnd(12) + '过期时间');
        console.log('─'.repeat(85));
        records.forEach((inv: any) => {
          console.log(
            String(inv.id).padEnd(10) +
            (inv.email || '-').substring(0, 26).padEnd(28) +
            (inv.role || '-').padEnd(10) +
            (inv.status || '-').padEnd(12) +
            (inv.expiresAt || '-')
          );
        });
        console.log('─'.repeat(85));
      } catch (error) {
        console.error('✗ 获取邀请列表失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // revoke invitation
  orgCommand
    .command('revoke-invitation <org-id> <invitation-id>')
    .description('Revoke a pending invitation')
    .action(async (orgId, invitationId) => {
      try {
        await apiClient.post(`/api/v1/orgs/${orgId}/invitations/${invitationId}/revoke`);
        console.log(`✓ 邀请已撤销: ${invitationId}`);
      } catch (error) {
        console.error('✗ 撤销邀请失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // resend invitation
  orgCommand
    .command('resend-invitation <org-id> <invitation-id>')
    .description('Resend an invitation with a fresh token')
    .action(async (orgId, invitationId) => {
      try {
        await apiClient.post(`/api/v1/orgs/${orgId}/invitations/${invitationId}/resend`);
        console.log(`✓ 邀请已重新发送: ${invitationId}`);
      } catch (error) {
        console.error('✗ 重新发送邀请失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // my invitations
  orgCommand
    .command('my-invitations')
    .description('List my pending invitations')
    .option('-p, --page <num>', 'Page number', '1')
    .option('-l, --limit <num>', 'Items per page', '20')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const params = {
          page: parseInt(options.page) || 1,
          pageSize: parseInt(options.limit) || 20,
        };
        const result = await apiClient.get('/api/v1/orgs/invitations/mine', params);
        // fix: #4 https://github.com/good7ob/g7b-cli/issues/4
        const records = extractRecords(result);

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        if (!records.length) {
          console.log('No pending invitations.');
          return;
        }

        console.log('\n我的邀请');
        console.log('─'.repeat(80));
        console.log('组织名称'.padEnd(24) + '邀请角色'.padEnd(12) + '邀请人'.padEnd(18) + 'Token 过期时间');
        console.log('─'.repeat(80));
        records.forEach((inv: any) => {
          console.log(
            (inv.orgName || '-').substring(0, 22).padEnd(24) +
            (inv.role || '-').padEnd(12) +
            (inv.inviterName || '-').substring(0, 16).padEnd(18) +
            (inv.expiresAt || '-')
          );
        });
        console.log('─'.repeat(80));
        console.log('使用 "org accept-invitation <token>" 接受邀请');
      } catch (error) {
        console.error('✗ 获取邀请列表失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // accept invitation
  orgCommand
    .command('accept-invitation <token>')
    .description('Accept an organization invitation by token')
    .action(async (token) => {
      try {
        const result = await apiClient.post(`/api/v1/orgs/invitations/${token}/accept`);
        console.log(`✓ 已接受邀请，加入组织: ${result?.orgName || ''}`);
      } catch (error) {
        console.error('✗ 接受邀请失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // decline invitation
  orgCommand
    .command('decline-invitation <token>')
    .description('Decline an organization invitation by token')
    .action(async (token) => {
      try {
        await apiClient.post(`/api/v1/orgs/invitations/${token}/decline`);
        console.log(`✓ 已拒绝邀请`);
      } catch (error) {
        console.error('✗ 拒绝邀请失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // transfer ownership
  orgCommand
    .command('transfer-ownership <org-id>')
    .description('Initiate ownership transfer to another member')
    .requiredOption('--to <user-id>', 'Target user ID to transfer ownership to')
    .action(async (orgId, options) => {
      try {
        await apiClient.post(`/api/v1/orgs/${orgId}/ownership-transfer`, {
          targetUserId: parseInt(options.to),
        });
        console.log(`✓ 所有权转让请求已发送: 组织 ${orgId} → 用户 ${options.to}`);
        console.log(`  对方需要通过邮件确认链接完成转让`);
      } catch (error) {
        console.error('✗ 发起所有权转让失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}

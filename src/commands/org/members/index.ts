import { Command } from 'commander';
import apiClient from '../../../services/ApiClient';

export function registerMemberCommands(orgCommand: Command) {
  // members list
  orgCommand
    .command('members <org-id>')
    .description('List organization members')
    .option('--role <role>', 'Filter by role (owner|admin|member)')
    .option('--status <status>', 'Filter by status (active|pending|suspended)')
    .option('--search <keyword>', 'Search by name or email')
    .option('--sort <field>', 'Sort field', 'joinedAt')
    .option('--order <direction>', 'Sort direction (asc|desc)', 'desc')
    .option('-p, --page <num>', 'Page number', '1')
    .option('-l, --limit <num>', 'Items per page', '20')
    .option('--json', 'Output as JSON')
    .option('--csv', 'Output as CSV')
    .action(async (orgId, options) => {
      try {
        const params: any = {
          page: parseInt(options.page) || 1,
          pageSize: parseInt(options.limit) || 20,
          sortBy: options.sort,
          sortOrder: options.order,
        };
        if (options.role) params.role = options.role;
        if (options.status) params.status = options.status;
        if (options.search) params.keyword = options.search;

        const result = await apiClient.get(`/api/v1/orgs/${orgId}/members`, params);
        const records = result?.records || result?.members || result || [];

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        if (options.csv) {
          console.log('UserID,Name,Email,Role,Status,JoinedAt');
          records.forEach((m: any) => {
            console.log(`${m.userId},${m.displayName || ''},${m.email || ''},${m.role},${m.status || ''},${m.joinedAt || ''}`);
          });
          return;
        }

        if (!records.length) {
          console.log('No members found.');
          return;
        }

        console.log(`\n组织成员 — 组织 ${orgId}`);
        console.log('─'.repeat(90));
        console.log(
          'UserID'.padEnd(10) +
          '姓名'.padEnd(20) +
          'Email'.padEnd(28) +
          '角色'.padEnd(10) +
          '状态'.padEnd(12) +
          '加入时间'
        );
        console.log('─'.repeat(90));
        records.forEach((m: any) => {
          console.log(
            String(m.userId).padEnd(10) +
            (m.displayName || '-').substring(0, 18).padEnd(20) +
            (m.email || '-').substring(0, 26).padEnd(28) +
            (m.role || '-').padEnd(10) +
            (m.status || '-').padEnd(12) +
            (m.joinedAt || '-')
          );
        });
        console.log('─'.repeat(90));
        if (result?.total) {
          console.log(`共 ${result.total} 人，第 ${params.page}/${Math.ceil(result.total / params.pageSize)} 页`);
        }
        if (result?.stats) {
          const s = result.stats;
          console.log(`  owner: ${s.ownerCount || 0}  admin: ${s.adminCount || 0}  member: ${s.memberCount || 0}`);
        }
      } catch (error) {
        console.error('✗ 获取成员列表失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // invite
  orgCommand
    .command('invite <org-id>')
    .description('Invite a member to the organization by email')
    .requiredOption('--email <email>', 'Email address to invite')
    .option('--role <role>', 'Role for the new member (admin|member)', 'member')
    .action(async (orgId, options) => {
      try {
        await apiClient.post(`/api/v1/orgs/${orgId}/members/invite`, {
          email: options.email,
          role: options.role,
        });
        console.log(`✓ 邀请已发送: ${options.email} (角色: ${options.role})`);
      } catch (error) {
        console.error('✗ 发送邀请失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // batch-invite
  orgCommand
    .command('batch-invite <org-id>')
    .description('Batch invite up to 10 members by email')
    .requiredOption('--emails <emails>', 'Comma-separated email addresses (max 10)')
    .option('--role <role>', 'Role for all invitees (admin|member)', 'member')
    .option('--message <msg>', 'Custom invitation message')
    .action(async (orgId, options) => {
      try {
        const emails = options.emails.split(',').map((e: string) => e.trim()).filter(Boolean);
        if (emails.length > 10) {
          console.error('✗ 最多批量邀请 10 人');
          process.exit(1);
        }
        const body: any = { emails, role: options.role };
        if (options.message) body.message = options.message;

        const result = await apiClient.post(`/api/v1/orgs/${orgId}/members/batch-invite`, body);
        console.log(`✓ 已发送 ${emails.length} 份邀请`);
        if (result?.failed?.length) {
          console.log(`⚠ 失败: ${result.failed.join(', ')}`);
        }
      } catch (error) {
        console.error('✗ 批量邀请失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // update-member role
  orgCommand
    .command('update-member <org-id> <user-id>')
    .description('Update a member\'s role in the organization')
    .requiredOption('--role <role>', 'New role (admin|member)')
    .action(async (orgId, userId, options) => {
      try {
        await apiClient.put(`/api/v1/orgs/${orgId}/members/${userId}`, { role: options.role });
        console.log(`✓ 成员角色已更新: 用户 ${userId} → ${options.role}`);
      } catch (error) {
        console.error('✗ 更新成员角色失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // remove-member
  orgCommand
    .command('remove-member <org-id> <user-id>')
    .description('Remove a member from the organization')
    .option('-f, --force', 'Skip confirmation')
    .action(async (orgId, userId, options) => {
      try {
        if (!options.force) {
          console.log(`⚠ 即将移除用户 ${userId}，使用 -f/--force 确认`);
          process.exit(0);
        }
        await apiClient.delete(`/api/v1/orgs/${orgId}/members/${userId}`);
        console.log(`✓ 成员已移除: 用户 ${userId}`);
      } catch (error) {
        console.error('✗ 移除成员失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // leave
  orgCommand
    .command('leave <org-id>')
    .description('Leave an organization (self-exit)')
    .option('-f, --force', 'Skip confirmation')
    .action(async (orgId, options) => {
      try {
        if (!options.force) {
          console.log(`⚠ 即将退出组织 ${orgId}，使用 -f/--force 确认`);
          process.exit(0);
        }
        await apiClient.post(`/api/v1/orgs/${orgId}/members/leave`);
        console.log(`✓ 已退出组织: ${orgId}`);
      } catch (error) {
        console.error('✗ 退出组织失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}

import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { emit, fail, parseId } from '../../utils/cliHelpers';
import { APPROVAL_ERROR_CODES, STATUSES, buildDecisionBody, buildListParams } from './input';
import { Approval, renderApprovalDetail, renderApprovalList } from './render';

/**
 * Approval commands (/approvals): decide the requests other features open (a release
 * asks via `good7ob release request-approval`). There is no "create approval" command
 * because the backend has no such endpoint by design.
 *
 * Business errors come back as HTTP 200 + non-200 `code`; ApiClient throws on those and
 * `fail` maps the approval error codes to readable messages.
 */

const BASE = '/approvals';

export function registerApprovalCommands(program: Command) {
  const approval = program
    .command('approval')
    .description('Approvals — list, inspect, approve, reject or cancel requests (e.g. release approvals)');

  approval
    .command('list')
    .description('List approvals of my organizations, newest first (--mine: only those I can decide)')
    .option('--status <status>', `Filter by status (${STATUSES.join('|')})`)
    .option('--target-type <type>', 'Filter by target type, e.g. RELEASE, PRD (case-insensitive)')
    .option('--target-id <id>', 'Filter by target id (with --target-type)')
    .option('--product <id>', 'Filter by product id')
    .option('--mine', 'Only pending requests I can decide (implies --status pending)')
    .option('-p, --page <num>', 'Page number', '1')
    .option('--page-size <num>', 'Items per page (1-100)', '20')
    .option('--json', 'Output as JSON')
    .action(async (o) => {
      try {
        const params = buildListParams(o);
        const result = await apiClient.get(BASE, params);
        emit(o.json, result, () => renderApprovalList(result, Number(params.pageNum), Number(params.pageSize)));
      } catch (error) {
        fail('获取审批列表失败', error, APPROVAL_ERROR_CODES);
      }
    });

  approval
    .command('get <id>')
    .description('Show an approval, including whether I can decide / cancel it')
    .option('--json', 'Output as JSON')
    .action(async (id, o) => {
      try {
        const detail: Approval = await apiClient.get(`${BASE}/${parseId(id, 'id')}`);
        emit(o.json, detail, () => renderApprovalDetail(detail ?? { id: Number(id) }));
      } catch (error) {
        fail('获取审批详情失败', error, APPROVAL_ERROR_CODES);
      }
    });

  const decide = (cmd: Command, verb: 'approve' | 'reject', done: string, failPrefix: string) =>
    cmd
      .option('--json', 'Output as JSON')
      .action(async (id, o) => {
        try {
          const aid = parseId(id, 'id');
          const body = buildDecisionBody(o.comment, verb === 'reject');
          const decided: Approval = await apiClient.post(`${BASE}/${aid}/${verb}`, body);
          emit(o.json, decided, () => `✓ 审批 #${aid} ${done}` +
            (decided?.selfApproved ? '（⚠ 自批：你是该组织唯一的审批人）' : ''));
        } catch (error) {
          fail(failPrefix, error, APPROVAL_ERROR_CODES);
        }
      });

  decide(
    approval.command('approve <id>')
      .description('Approve a pending request (owner/admin, not the requester)')
      .option('--comment <text>', 'Optional comment'),
    'approve', '已批准 (approved)', '批准审批失败',
  );
  decide(
    approval.command('reject <id>')
      .description('Reject a pending request')
      .requiredOption('--comment <text>', 'Why (required)'),
    'reject', '已驳回 (rejected)', '驳回审批失败',
  );

  approval
    .command('cancel <id>')
    .description('Cancel a pending request (requester or owner/admin)')
    .option('--json', 'Output as JSON')
    .action(async (id, o) => {
      try {
        const aid = parseId(id, 'id');
        const cancelled: Approval = await apiClient.post(`${BASE}/${aid}/cancel`);
        emit(o.json, cancelled, () => `✓ 审批 #${aid} 已撤销 (cancelled)`);
      } catch (error) {
        fail('撤销审批失败', error, APPROVAL_ERROR_CODES);
      }
    });
}

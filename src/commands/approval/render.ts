import { ApiDate, DASH, dash, fmtDateTime, renderTable } from '../../utils/cliHelpers';
import { extractRecords, extractTotal } from '../../utils/extractRecords';

export interface Approval {
  id: number;
  orgId?: number | null;
  productId?: number | null;
  targetType?: string | null;
  targetId?: number | null;
  title?: string | null;
  description?: string | null;
  requestedBy?: number | null;
  status?: string | null;
  decidedBy?: number | null;
  decisionComment?: string | null;
  decidedAt?: ApiDate;
  selfApproved?: boolean | null;
  createdAt?: ApiDate;
  updatedAt?: ApiDate;
  canDecide?: boolean | null;
  canCancel?: boolean | null;
}

const yesNo = (v: boolean | null | undefined) => (v === null || v === undefined ? DASH : v ? '是' : '否');
const target = (a: Approval) => (a.targetType ? `${a.targetType}#${dash(a.targetId)}` : DASH);

export function renderApprovalList(result: unknown, pageNum: number, pageSize: number): string {
  const records = extractRecords<Approval>(result);
  if (!records.length) return '没有符合条件的审批。';

  const rows = [['ID', '状态', '目标', '标题', '申请人', '可决定', '创建时间']].concat(
    records.map((a) => [
      String(a.id), dash(a.status), target(a), dash(a.title), dash(a.requestedBy), yesNo(a.canDecide), fmtDateTime(a.createdAt),
    ])
  );
  const total = extractTotal(result, records);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return `${renderTable(rows, { 3: { truncate: 40 } })}\n共 ${total} 条，第 ${pageNum}/${pages} 页`;
}

export function renderApprovalDetail(a: Approval): string {
  const lines = [
    `审批 #${a.id}  ${dash(a.title)}`,
    '─'.repeat(60),
    `状态:     ${dash(a.status)}    目标: ${target(a)}    产品: ${dash(a.productId)}    组织: ${dash(a.orgId)}`,
    `申请:     by ${dash(a.requestedBy)} @ ${fmtDateTime(a.createdAt)}`,
    `我能决定: ${yesNo(a.canDecide)}    我能撤销: ${yesNo(a.canCancel)}`,
  ];
  if (a.status && a.status !== 'pending') {
    lines.push(`决定:     ${a.status} by ${dash(a.decidedBy)} @ ${fmtDateTime(a.decidedAt)}`);
    lines.push(`意见:     ${dash(a.decisionComment)}`);
  }
  if (a.selfApproved) lines.push('⚠ 自批：申请人在自己是组织唯一审批人时批准了自己的申请');
  if (a.description) lines.push('', '说明:', a.description);
  return lines.join('\n');
}

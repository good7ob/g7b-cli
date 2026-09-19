import { ApiDate, dash, fmtDateTime, renderTable } from '../../utils/cliHelpers';
import { extractRecords, extractTotal } from '../../utils/extractRecords';

export interface TraceLink {
  id: number;
  productId?: number;
  sourceType?: string | null;
  sourceId?: number | null;
  targetType?: string | null;
  targetId?: number | null;
  linkType?: string | null;
  createdBy?: number | null;
  createdAt?: ApiDate;
}

const end = (type?: string | null, id?: number | null) => `${dash(type)}#${dash(id)}`;

export function renderTraceList(result: unknown, pageNum: number, pageSize: number): string {
  const records = extractRecords<TraceLink>(result);
  if (!records.length) return '没有符合条件的追溯关系。';

  const rows = [['ID', '来源', '关系', '目标', '创建人', '创建时间']].concat(
    records.map((l) => [
      String(l.id), end(l.sourceType, l.sourceId), dash(l.linkType), end(l.targetType, l.targetId),
      dash(l.createdBy), fmtDateTime(l.createdAt),
    ])
  );
  const total = extractTotal(result, records);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return `${renderTable(rows)}\n共 ${total} 条，第 ${pageNum}/${pages} 页`;
}

/** `IDEA#5 —derived_from→ REQUIREMENT#9` */
export function describeLink(l: TraceLink): string {
  return `${end(l.sourceType, l.sourceId)} —${dash(l.linkType)}→ ${end(l.targetType, l.targetId)}`;
}

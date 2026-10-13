/**
 * File format of `good7ob cloud-arch import|export` — the same shape the backend's
 * POST /forge/cloud-arch/diagrams/import takes (minus orgId, which comes from --org).
 */
import { InputError } from '../../utils/cliHelpers';

export interface ArchNode { clientId: string; nodeType: string; label: string; posX?: number; posY?: number; refType?: string; refId?: number; metaJson?: string }
export interface ArchEdge { fromClientId: string; toClientId: string; label?: string; connType?: string }
export interface ArchFile { name: string; env?: string; platform?: string; description?: string; status?: string; nodes: ArchNode[]; connections: ArchEdge[] }

export function parseArchFile(raw: unknown): ArchFile {
  const f = raw as Partial<ArchFile> | null;
  if (!f || typeof f !== 'object' || typeof f.name !== 'string' || !f.name.trim()) throw new InputError('文件缺少 name');
  const nodes = f.nodes ?? [];
  const connections = f.connections ?? [];
  if (!Array.isArray(nodes) || !Array.isArray(connections)) throw new InputError('nodes / connections 必须是数组');
  const ids = new Set<string>();
  nodes.forEach((n, i) => {
    if (!n?.clientId || !n.label || !n.nodeType) throw new InputError(`nodes[${i}] 需要 clientId / nodeType / label`);
    if (ids.has(n.clientId)) throw new InputError(`nodes[${i}] clientId 重复: ${n.clientId}`);
    ids.add(n.clientId);
  });
  connections.forEach((c, i) => {
    if (!ids.has(c?.fromClientId) || !ids.has(c?.toClientId)) throw new InputError(`connections[${i}] 引用了不存在的节点`);
  });
  return { ...(f as ArchFile), nodes, connections };
}

/** Rebuild the file shape from GET /diagrams/{id}/canvas (nodes carry db ids; edges are remapped to clientIds). */
export function fromCanvasView(view: any): ArchFile {
  const d = view.diagram;
  const key = (id: number) => `n${id}`;
  return {
    name: d.name, env: d.env, platform: d.platform, description: d.description, status: d.status,
    nodes: view.nodes.map((n: any) => ({
      clientId: key(n.id), nodeType: n.nodeType, label: n.label, posX: n.posX, posY: n.posY,
      refType: n.refType, refId: n.refId ?? undefined, metaJson: n.metaJson ?? undefined,
    })),
    connections: view.connections.map((c: any) => ({
      fromClientId: key(c.fromNodeId), toClientId: key(c.toNodeId), label: c.label, connType: c.connType,
    })),
  };
}

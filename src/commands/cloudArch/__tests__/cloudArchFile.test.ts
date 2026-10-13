import { describe, expect, it } from 'vitest';
import { fromCanvasView, parseArchFile } from '../cloudArchFile';

const ok = { name: 'prd', nodes: [{ clientId: 'a', nodeType: 'service', label: 'A' }, { clientId: 'b', nodeType: 'database', label: 'B' }], connections: [{ fromClientId: 'a', toClientId: 'b' }] };

describe('parseArchFile', () => {
  it('accepts a valid file', () => expect(parseArchFile(ok).nodes).toHaveLength(2));
  it('rejects missing name', () => expect(() => parseArchFile({ nodes: [] })).toThrow('name'));
  it('rejects duplicate clientId', () =>
    expect(() => parseArchFile({ ...ok, nodes: [ok.nodes[0], ok.nodes[0]] })).toThrow('重复'));
  it('rejects edges to unknown nodes', () =>
    expect(() => parseArchFile({ ...ok, connections: [{ fromClientId: 'a', toClientId: 'zzz' }] })).toThrow('不存在'));
});

describe('fromCanvasView', () => {
  it('round-trips into an importable file', () => {
    const f = fromCanvasView({
      diagram: { name: 'prd', env: 'prod', platform: 'aws', description: '', status: 'draft' },
      nodes: [{ id: 1, nodeType: 'service', label: 'A', posX: 0, posY: 0 }, { id: 2, nodeType: 'database', label: 'B', posX: 1, posY: 1 }],
      connections: [{ fromNodeId: 1, toNodeId: 2, label: '', connType: 'sync' }],
    });
    expect(() => parseArchFile(f)).not.toThrow();
    expect(f.connections[0]).toMatchObject({ fromClientId: 'n1', toClientId: 'n2' });
  });
});

/**
 * Tests for `good7ob schema import` — export validation, module mapping, planner, idempotent sync.
 */

import { describe, expect, it } from 'vitest';
import {
  buildDesired, changedFields, duplicateNotes, exportSql, moduleFor, OTHER_MODULE, parseExport,
  SchemaExport, syncSchema,
} from '../schemaImport';

const col = (name: string, extra: Record<string, unknown> = {}) => ({
  name, type: 'bigint', nullable: true, default: null, pk: false, fkTable: null, fkColumn: null, comment: null, ...extra,
});

const EXPORT: SchemaExport = parseExport({
  schema: 'good7ob_dev',
  tables: [
    { name: 'pm_tasks', comment: null, columns: [col('id', { pk: true, nullable: false })] },
    { name: 'pm_task', comment: '任务', columns: [
      col('id', { pk: true, nullable: false, default: "nextval('pm_task_id_seq'::regclass)" }),
      col('project_id', { fkTable: 'pm_project', fkColumn: 'id', comment: '项目' }),
    ] },
    { name: 'advertisement', comment: null, columns: [col('id')] },
    { name: 'ad_review', comment: null, columns: [col('ad_id', { fkTable: 'advertisement', fkColumn: 'id' })] },
  ],
});

/** In-memory stand-in for /forge/schema/*, with the backend's uniqueness rules. */
function fakeApi(opts: { failOn?: RegExp; rateLimitOnce?: RegExp } = {}) {
  let seq = 0;
  const modules: any[] = [];
  const tables: any[] = [];
  const columns: any[] = [];
  const writes: string[] = [];
  const limited = new Set<string>();
  const guard = (url: string) => {
    if (opts.failOn?.test(url)) throw new Error('boom');
    if (opts.rateLimitOnce?.test(url) && !limited.has(url)) { limited.add(url); throw new Error('Too many requests'); }
  };
  const client = {
    async get(url: string, params?: any) {
      guard(url);
      if (url === '/forge/schema/modules') return modules.filter((m) => m.orgId === params.orgId);
      let m = /^\/forge\/schema\/modules\/(\d+)\/tables$/.exec(url);
      if (m) return tables.filter((t) => t.moduleId === +m![1]);
      m = /^\/forge\/schema\/tables\/(\d+)\/columns$/.exec(url);
      if (m) return columns.filter((c) => c.tableId === +m![1]);
      throw new Error(`unexpected GET ${url}`);
    },
    async post(url: string, body: any) {
      guard(url);
      writes.push(`POST ${url}`);
      if (url === '/forge/schema/modules') {
        if (modules.some((x) => x.orgId === body.orgId && x.name === body.name)) throw new Error('duplicate module');
        const row = { id: ++seq, ...body }; modules.push(row); return row;
      }
      let m = /^\/forge\/schema\/modules\/(\d+)\/tables$/.exec(url);
      if (m) {
        const orgId = modules.find((x) => x.id === +m![1]).orgId;
        if (tables.some((t) => t.orgId === orgId && t.tableName === body.tableName)) throw new Error('duplicate table');
        const row = { id: ++seq, moduleId: +m[1], orgId, ...body }; tables.push(row); return row;
      }
      m = /^\/forge\/schema\/tables\/(\d+)\/columns$/.exec(url);
      if (m) {
        if (columns.some((c) => c.tableId === +m![1] && c.columnName === body.columnName)) throw new Error('duplicate column');
        const row = { id: ++seq, tableId: +m[1], ...body }; columns.push(row); return row;
      }
      throw new Error(`unexpected POST ${url}`);
    },
    async put(url: string, body: any) {
      guard(url);
      writes.push(`PUT ${url}`);
      const id = +url.split('/').pop()!;
      const row = [...modules, ...tables, ...columns].find((x) => x.id === id);
      Object.assign(row, body);
      return row;
    },
  };
  return { client, modules, tables, columns, writes };
}

const fast = { concurrency: 3, retryDelaysMs: [1, 1] };

describe('exportSql', () => {
  it('targets the requested schema and skips flyway history', () => {
    const sql = exportSql('good7ob_dev');
    expect(sql).toContain("n.nspname = 'good7ob_dev'");
    expect(sql).toContain("<> 'flyway_schema_history'");
  });

  it('rejects anything that is not a plain identifier', () => {
    expect(() => exportSql("x'; drop table y; --")).toThrow(/不合法/);
  });
});

describe('parseExport', () => {
  it('rejects files that are not an export', () => {
    expect(() => parseExport([])).toThrow(/格式不对/);
    expect(() => parseExport({ schema: 's', tables: [{ name: 't' }] })).toThrow(/tables\[0\]/);
    expect(() => parseExport({ schema: 's', tables: [{ name: 't', columns: [{}] }] })).toThrow(/t\.columns\[0\]/);
  });
});

describe('moduleFor', () => {
  it('matches whole prefix tokens, not substrings', () => {
    expect(moduleFor('ad_review').name).toBe('广告');
    expect(moduleFor('advertisement').name).toBe(OTHER_MODULE);
    expect(moduleFor('t_blog').name).toBe('迁移遗留（t_）');
    expect(moduleFor('tpl_template').name).toBe('模板中心');
    expect(moduleFor('personal_secretary_todos').name).toBe('秘书助手');
    expect(moduleFor('privilege').name).toBe('权限');
  });
});

describe('duplicateNotes', () => {
  it('flags both sides of a singular/plural pair and nothing else', () => {
    const notes = duplicateNotes(['pm_task', 'pm_tasks', 'cases', 'kb_document']);
    expect(notes.get('pm_task')).toBe('疑似重复：与 pm_tasks 并存');
    expect(notes.get('pm_tasks')).toBe('疑似重复：与 pm_task 并存');
    expect(notes.has('cases')).toBe(false);
  });
});

describe('buildDesired', () => {
  it('groups by module in fixed order, sorts tables, maps columns', () => {
    const modules = buildDesired(EXPORT);
    expect(modules.map((m) => m.name)).toEqual(['项目管理', '广告', OTHER_MODULE]);
    const pm = modules[0];
    expect(pm.prefix).toBe('pm_');
    expect(pm.tables.map((t) => [t.tableName, t.description, t.sortOrder])).toEqual([
      ['pm_task', '任务；疑似重复：与 pm_tasks 并存', 0],
      ['pm_tasks', '疑似重复：与 pm_task 并存', 1],
    ]);
    expect(pm.tables[0].columns[1]).toEqual({
      columnName: 'project_id', dataType: 'bigint', nullable: true, defaultVal: null, isPk: false,
      isFk: true, fkRefTable: 'pm_project', fkRefColumn: 'id', description: '项目', sortOrder: 1,
    });
    expect(modules[2].prefix).toBe('');
  });
});

describe('changedFields', () => {
  it('treats null, undefined and empty string as equal', () => {
    expect(changedFields({ a: null, b: '', c: 1 }, { a: '', b: undefined, c: 2 }, ['a', 'b', 'c'])).toEqual(['c']);
  });
});

describe('syncSchema', () => {
  it('creates everything on an empty org', async () => {
    const api = fakeApi();
    const r = await syncSchema(api.client, 58, buildDesired(EXPORT), { dryRun: false, ...fast });
    expect(r.counts.module).toEqual({ create: 3, update: 0, unchanged: 0 });
    expect(r.counts.table).toEqual({ create: 4, update: 0, unchanged: 0 });
    expect(r.counts.column).toEqual({ create: 5, update: 0, unchanged: 0 });
    expect(api.tables.find((t) => t.tableName === 'ad_review').moduleId)
      .toBe(api.modules.find((m) => m.name === '广告').id);
    expect(api.columns.find((c) => c.columnName === 'project_id')).toMatchObject({ isFk: true, fkRefTable: 'pm_project' });
  });

  it('is a no-op on rerun', async () => {
    const api = fakeApi();
    await syncSchema(api.client, 58, buildDesired(EXPORT), { dryRun: false, ...fast });
    const before = api.writes.length;
    const r = await syncSchema(api.client, 58, buildDesired(EXPORT), { dryRun: false, ...fast });
    expect(api.writes.length).toBe(before);
    expect(r.actions).toEqual([]);
    expect(r.counts.column.unchanged).toBe(5);
  });

  it('updates only what changed', async () => {
    const api = fakeApi();
    await syncSchema(api.client, 58, buildDesired(EXPORT), { dryRun: false, ...fast });
    api.columns.find((c) => c.columnName === 'project_id').description = '旧说明';
    api.tables.find((t) => t.tableName === 'pm_task').status = 'draft';
    const before = api.writes.length;
    const r = await syncSchema(api.client, 58, buildDesired(EXPORT), { dryRun: false, ...fast });
    expect(r.actions).toEqual([
      { layer: 'table', op: 'update', id: 'pm_task', fields: ['status'] },
      { layer: 'column', op: 'update', id: 'pm_task.project_id', fields: ['description'] },
    ]);
    expect(api.writes.length - before).toBe(2);
    expect(api.columns.find((c) => c.columnName === 'project_id').description).toBe('项目');
  });

  it('dry-run plans without writing', async () => {
    const api = fakeApi();
    const r = await syncSchema(api.client, 58, buildDesired(EXPORT), { dryRun: true, ...fast });
    expect(api.writes).toEqual([]);
    expect(r.counts.table.create).toBe(4);
    expect(r.counts.column.create).toBe(5);
  });

  it('skips a table already registered under another module instead of failing', async () => {
    const api = fakeApi();
    const elsewhere = await api.client.post('/forge/schema/modules', { orgId: 58, name: '手工模块' });
    await api.client.post(`/forge/schema/modules/${elsewhere.id}/tables`, { tableName: 'pm_tasks' });
    const r = await syncSchema(api.client, 58, buildDesired(EXPORT), { dryRun: false, ...fast });
    expect(r.conflicts).toEqual(['pm_tasks（已在模块「手工模块」下）']);
    expect(r.counts.table.create).toBe(3);
  });

  it('retries a rate-limited write', async () => {
    const api = fakeApi({ rateLimitOnce: /\/columns$/ });
    const r = await syncSchema(api.client, 58, buildDesired(EXPORT), { dryRun: false, ...fast });
    expect(r.counts.column.create).toBe(5);
    expect(api.columns).toHaveLength(5);
  });

  it('stops on other errors and reports what was done', async () => {
    const api = fakeApi({ failOn: /\/columns$/ });
    const err: any = await syncSchema(api.client, 58, buildDesired(EXPORT), { dryRun: false, ...fast }).catch((e) => e);
    expect(err.message).toMatch(/: boom$/);
    expect(err.partial.counts.module.create).toBe(3);
  });
});

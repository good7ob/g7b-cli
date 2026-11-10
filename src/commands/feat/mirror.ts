/**
 * Mirror of a freshly initialised feature into the local Admin Cockpit SQLite file (`feat init`, step 2).
 *
 * The script is a constant: everything that varies (the feature name, ids from the server, the file path) travels
 * as one JSON argument and is bound with SQL parameters, so none of it is ever read as shell or Python code.
 */

export interface MirrorSubtask {
  id: number | string;
  title: string;
  hours: number;
  artifactType: string;
}

export interface MirrorPayload {
  db: string;
  projectId: number;
  parent: { id: number | string; title: string; hours: number };
  subs: MirrorSubtask[];
}

export const MIRROR_SCRIPT = `
import sqlite3, uuid, datetime, json, sys
p = json.loads(sys.argv[1])
conn = sqlite3.connect(p['db'])
cur = conn.cursor()
cur.execute("SELECT id FROM Project WHERE good7obProjectId=?", (p['projectId'],))
row = cur.fetchone()
if row:
    proj_id = row[0]
    p_id = 'c' + uuid.uuid4().hex[:24]
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    url = lambda task_id: "https://good7ob.net/projectManagement/detail/%s?taskId=%s" % (p['projectId'], task_id)
    cur.execute("INSERT INTO Task (id, title, description, status, priority, good7obTaskId, good7obUrl, estimatedHours, projectId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (p_id, p['parent']['title'], "标准流水线 Parent 任务", "not_started", "high", p['parent']['id'], url(p['parent']['id']), p['parent']['hours'], proj_id, now, now))
    for s in p['subs']:
        cur.execute("INSERT INTO Task (id, title, description, status, priority, good7obTaskId, good7obUrl, estimatedHours, projectId, parentId, artifactType, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            ('c' + uuid.uuid4().hex[:24], s['title'], "", "not_started", "high", s['id'], url(s['id']), s['hours'], proj_id, p_id, s['artifactType'], now, now))
    conn.commit()
    print("OK")
else:
    print("NO_PROJECT")
`;

/** argv for `execFileSync('python3', ...)`: the constant script, then the payload as data. */
export function mirrorArgs(payload: MirrorPayload): string[] {
  return ['-c', MIRROR_SCRIPT, JSON.stringify(payload)];
}

export function buildMirrorPayload(db: string, projectId: number, featName: string, parentId: number | string, subIds: Array<number | string>): MirrorPayload {
  const [prd, wireframe, design, tests] = subIds;
  return {
    db,
    projectId,
    parent: { id: parentId, title: `${featName} 全生命周期规范实施`, hours: 15.0 },
    subs: [
      { id: prd, title: `PRD: ${featName} (good7ob/prd)`, hours: 4.0, artifactType: 'design_doc' },
      { id: wireframe, title: `Wireframe: ${featName} (good7ob/wireframe)`, hours: 3.5, artifactType: 'design_doc' },
      { id: design, title: `详细设计: ${featName} (good7ob/detailed-design-document)`, hours: 4.0, artifactType: 'design_doc' },
      { id: tests, title: `测试用例与 E2E: ${featName} (front-web/e2e)`, hours: 3.5, artifactType: 'test_report' },
    ],
  };
}

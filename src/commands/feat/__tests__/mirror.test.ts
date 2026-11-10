import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { MIRROR_SCRIPT, buildMirrorPayload, mirrorArgs } from '../mirror';

const HOSTILE = 'x$(touch PWNED)`touch PWNED`"; import os; os.system("touch PWNED") #\'';

describe('feat init local mirror', () => {
  it('keeps the feature name out of the script: it only travels as the JSON argument', () => {
    const args = mirrorArgs(buildMirrorPayload('/tmp/dev.db', 7, HOSTILE, 100, [101, 102, 103, 104]));
    expect(args).toHaveLength(3);
    expect(args[1]).toBe(MIRROR_SCRIPT);
    expect(args[1]).not.toContain('PWNED');
    expect(JSON.parse(args[2]).parent.title).toBe(`${HOSTILE} 全生命周期规范实施`);
  });

  it('stores a hostile name as plain text and runs none of it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g7b-mirror-'));
    try {
      const db = path.join(dir, "it's.db");
      const setup = [
        'import sqlite3, sys',
        'c = sqlite3.connect(sys.argv[1])',
        'c.execute("CREATE TABLE Project (id TEXT, good7obProjectId INTEGER)")',
        'c.execute("CREATE TABLE Task (id TEXT, title TEXT, description TEXT, status TEXT, priority TEXT, good7obTaskId INTEGER, good7obUrl TEXT, estimatedHours REAL, projectId TEXT, parentId TEXT, artifactType TEXT, createdAt TEXT, updatedAt TEXT)")',
        'c.execute("INSERT INTO Project VALUES (\'p1\', 7)")',
        'c.commit()',
      ].join('\n');
      try {
        execFileSync('python3', ['-c', setup, db], { stdio: 'pipe' });
      } catch {
        return; // no python3 with sqlite3 on this machine: the argv test above still holds
      }
      const out = execFileSync('python3', mirrorArgs(buildMirrorPayload(db, 7, HOSTILE, 100, [101, 102, 103, 104])), { cwd: dir, encoding: 'utf8' });
      expect(out.trim()).toBe('OK');
      const titles = execFileSync('python3', ['-c', 'import sqlite3, sys, json\nprint(json.dumps([r[0] for r in sqlite3.connect(sys.argv[1]).execute("SELECT title FROM Task ORDER BY good7obTaskId")]))', db], { encoding: 'utf8' });
      expect(JSON.parse(titles)).toEqual([
        `${HOSTILE} 全生命周期规范实施`,
        `PRD: ${HOSTILE} (good7ob/prd)`,
        `Wireframe: ${HOSTILE} (good7ob/wireframe)`,
        `详细设计: ${HOSTILE} (good7ob/detailed-design-document)`,
        `测试用例与 E2E: ${HOSTILE} (front-web/e2e)`,
      ]);
      expect(fs.readdirSync(dir)).toEqual(["it's.db"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

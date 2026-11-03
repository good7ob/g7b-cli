/**
 * Fake `plantuml`, `docker`, `java` and `dot` executables in a temp directory (put first on PATH), so the render
 * subprocess code is tested without a real PlantUML. The fake plantuml logs the environment it was started with.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const PLANTUML = `#!/bin/sh
case "$1" in
  -version) echo "PlantUML version \${FAKE_VERSION:-1.2026.8} (fake)"; exit 0;;
esac
echo "profile=$PLANTUML_SECURITY_PROFILE jto=\${JAVA_TOOL_OPTIONS:-};" >> "$FAKE_LOG"
src=$(cat)
case "$src" in
  *BAD*) echo "string:3:error:Syntax Error? (fake)" >&2; exit 200;;
esac
printf '\\211PNG\\r\\n\\032\\n'
printf 'fake-png-body'
`;

const DOCKER = `#!/bin/sh
echo "$@" >> "$FAKE_DOCKER_LOG"
for a in "$@"; do
  if [ "$a" = "-version" ]; then echo "PlantUML version \${FAKE_VERSION:-1.2026.8} (fake docker)"; exit 0; fi
done
cat > /dev/null
printf '\\211PNG\\r\\n\\032\\n'
printf 'fake-png-body'
`;

export function fakeTools() {
  let dir = '';
  let originalPath = '';
  const path_ = () => dir;
  return {
    setup() {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-fake-tools-'));
      originalPath = process.env.PATH ?? '';
      const put = (name: string, body: string) => { const p = path.join(dir, name); fs.writeFileSync(p, body); fs.chmodSync(p, 0o755); };
      put('plantuml', PLANTUML);
      put('docker', DOCKER);
      put('java', '#!/bin/sh\nexit 0\n');
      put('dot', '#!/bin/sh\nexit 0\n');
      fs.mkdirSync(path.join(dir, 'sys'));
      fs.symlinkSync('/bin/cat', path.join(dir, 'sys', 'cat'));
    },
    teardown() { fs.rmSync(dir, { recursive: true, force: true }); },
    /** Per test: fresh logs, fake tools first on PATH. */
    reset() {
      for (const f of ['plantuml.log', 'docker.log']) fs.rmSync(path.join(dir, f), { force: true });
      for (const t of ['java', 'dot']) { const p = path.join(dir, t); if (!fs.existsSync(p)) { fs.writeFileSync(p, '#!/bin/sh\nexit 0\n'); fs.chmodSync(p, 0o755); } }
    },
    useCommand(cmd: string) {
      process.env.PATH = `${dir}:${originalPath}`;
      process.env.FAKE_LOG = path.join(dir, 'plantuml.log');
      process.env.FAKE_DOCKER_LOG = path.join(dir, 'docker.log');
      process.env.GOOD7OB_PLANTUML_CMD = cmd;
    },
    removeTool(name: string) { fs.rmSync(path.join(dir, name), { force: true }); },
    /** PATH with the fake tools and `cat` only: no real java / dot can be found (scripts use an absolute #!/bin/sh). */
    onlyFakePath() { return `${dir}:${path.join(dir, 'sys')}`; },
    log: () => (fs.existsSync(path.join(dir, 'plantuml.log')) ? fs.readFileSync(path.join(dir, 'plantuml.log'), 'utf8') : ''),
    dockerArgs: () => (fs.existsSync(path.join(dir, 'docker.log')) ? fs.readFileSync(path.join(dir, 'docker.log'), 'utf8').trim().split('\n') : []),
    dir: path_,
  };
}

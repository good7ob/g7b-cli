import * as fs from 'fs';
import * as path from 'path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  RenderError, SetupError, buildInvocation, createRenderer, parseProblems, parseVersion, safeEnv, splitCommand,
} from '../plantuml';
import { fakeTools } from './fakeTools';

describe('splitCommand', () => {
  it('splits on whitespace and honours quotes', () => {
    expect(splitCommand('docker run --rm -i plantuml/plantuml:latest')).toEqual(['docker', 'run', '--rm', '-i', 'plantuml/plantuml:latest']);
    expect(splitCommand(`"/opt/my tools/plantuml" -x 'a b'`)).toEqual(['/opt/my tools/plantuml', '-x', 'a b']);
    expect(() => splitCommand('plantuml "oops')).toThrow(SetupError);
  });
});

describe('rp-ucase-0051 the security profile is forced', () => {
  it('overrides any value in the user environment with SANDBOX', () => {
    expect(safeEnv({ PLANTUML_SECURITY_PROFILE: 'NONE', PATH: '/bin' })).toMatchObject({ PLANTUML_SECURITY_PROFILE: 'SANDBOX', PATH: '/bin' });
    expect(safeEnv({ PLANTUML_SECURITY_PROFILE: 'INSECURE' }).PLANTUML_SECURITY_PROFILE).toBe('SANDBOX');
    expect(safeEnv({}).PLANTUML_SECURITY_PROFILE).toBe('SANDBOX');
    // a differently-cased name is a different variable on POSIX but the same one on Windows: drop it either way
    const env = safeEnv({ plantuml_security_profile: 'NONE' });
    expect(Object.keys(env).filter((k) => k.toUpperCase() === 'PLANTUML_SECURITY_PROFILE')).toEqual(['PLANTUML_SECURITY_PROFILE']);
  });

  it('drops JVM option variables that set the profile as a system property (they beat the env var)', () => {
    const env = safeEnv({ JAVA_TOOL_OPTIONS: '-DPLANTUML_SECURITY_PROFILE=INSECURE', _JAVA_OPTIONS: '-Dplantuml.security.profile=LEGACY', JDK_JAVA_OPTIONS: '-Xmx512m' });
    expect(env.JAVA_TOOL_OPTIONS).toBeUndefined();
    expect(env._JAVA_OPTIONS).toBeUndefined();
    expect(env.JDK_JAVA_OPTIONS).toBe('-Xmx512m'); // unrelated options are the user's business
  });

  it('inserts -e right after `docker run` (and --network none), before the image', () => {
    const { file, args } = buildInvocation(splitCommand('docker run --rm -i plantuml/plantuml:latest'), ['-pipe']);
    expect(file).toBe('docker');
    expect(args).toEqual(['run', '-i', '--network', 'none', '-e', 'PLANTUML_SECURITY_PROFILE=SANDBOX', '--rm', '-i', 'plantuml/plantuml:latest', '-pipe']);
  });

  it('strips what the user wrote against it in a docker command: -e profile, JAVA_TOOL_OPTIONS naming it, --network', () => {
    const tokens = splitCommand('docker run -e PLANTUML_SECURITY_PROFILE=NONE --env=PLANTUML_SECURITY_PROFILE=INSECURE -e JAVA_TOOL_OPTIONS=-DPLANTUML_SECURITY_PROFILE=LEGACY -e KEEP=1 --network=host --net host --rm img');
    const { args } = buildInvocation(tokens, []);
    expect(args.filter((a) => /PLANTUML_SECURITY_PROFILE/i.test(a))).toEqual(['PLANTUML_SECURITY_PROFILE=SANDBOX']);
    expect(args).toContain('KEEP=1');
    expect(args.join(' ')).not.toMatch(/host|LEGACY|INSECURE|NONE/);
    expect(args.join(' ')).toContain('--network none');
  });

  it('handles podman and a path to docker the same way', () => {
    expect(buildInvocation(splitCommand('/usr/local/bin/docker run img'), []).args.slice(0, 5)).toEqual(['run', '-i', '--network', 'none', '-e']);
    expect(buildInvocation(splitCommand('podman run img'), []).args).toContain('PLANTUML_SECURITY_PROFILE=SANDBOX');
  });

  it('refuses a container command that is not `run` (the profile could not be passed in) and a command that names the profile', () => {
    expect(() => buildInvocation(splitCommand('docker compose up plantuml'), [])).toThrow(/run/);
    expect(() => buildInvocation(splitCommand('java -DPLANTUML_SECURITY_PROFILE=NONE -jar p.jar'), [])).toThrow('安全档位');
  });

  it('keeps a plain command as it is, arguments appended', () => {
    expect(buildInvocation(splitCommand('java -jar /x/plantuml.jar'), ['-pipe'])).toEqual({ file: 'java', args: ['-jar', '/x/plantuml.jar', '-pipe'] });
  });
});

describe('PlantUML output parsing', () => {
  it('reads the version and the error lines PlantUML reports', () => {
    expect(parseVersion('PlantUML version 1.2026.8 / 149874a [2026-09-05]')?.text).toBe('1.2026.8');
    expect(parseVersion('hello')).toBeNull();
    expect(parseProblems('string:12:error:Syntax Error? (Assumed diagram type: sequence)\nnoise\nstring:2:error:cannot include /etc/hosts'))
      .toEqual([{ line: 12, message: 'Syntax Error? (Assumed diagram type: sequence)' }, { line: 2, message: 'cannot include /etc/hosts' }]);
  });
});

describe('createRenderer against a fake plantuml (subprocess)', () => {
  const tools = fakeTools();
  const saved = { ...process.env };
  beforeAll(() => tools.setup());
  afterAll(() => tools.teardown());
  afterEach(() => { process.env = { ...saved }; tools.reset(); });

  const OK = '@startuml\nA -> B\n@enduml\n';

  it('rp-ucase-0051 renders with PLANTUML_SECURITY_PROFILE=SANDBOX even when the user environment says otherwise', async () => {
    process.env.PLANTUML_SECURITY_PROFILE = 'NONE';
    process.env.JAVA_TOOL_OPTIONS = '-DPLANTUML_SECURITY_PROFILE=INSECURE';
    tools.useCommand('plantuml');
    const out = await createRenderer().render(OK);
    expect(out.version).toBe('1.2026.8');
    expect(out.png.subarray(1, 4).toString()).toBe('PNG');
    const log = tools.log();
    expect(log).toContain('profile=SANDBOX');
    expect(log).not.toContain('NONE');
    expect(log).toContain('jto=;'); // the option variable naming the profile never reached the child
  });

  it('rp-ucase-0051 passes the profile into the container for docker run', async () => {
    tools.useCommand('docker run --rm -i plantuml/plantuml:latest');
    await createRenderer().render(OK);
    const argv = tools.dockerArgs().find((l) => !l.includes('-version'))!;
    expect(argv).toBe('run -i --network none -e PLANTUML_SECURITY_PROFILE=SANDBOX --rm -i plantuml/plantuml:latest -pipe -tpng -failonerror -stdrpt:2 -charset UTF-8');
  });

  it('rp-ucase-0050 reports PlantUML’s error with its line number, not a PNG', async () => {
    tools.useCommand('plantuml');
    const failing = createRenderer().render('@startuml\nA -> B\nBAD\n@enduml\n');
    await expect(failing).rejects.toBeInstanceOf(RenderError);
    await expect(failing).rejects.toMatchObject({ problems: [{ line: 3, message: 'Syntax Error? (fake)' }] });
  });

  it('rp-ucase-0051 refuses when PlantUML is missing and says how to install it', async () => {
    tools.useCommand('plantuml-does-not-exist');
    const r = createRenderer();
    await expect(r.render(OK)).rejects.toBeInstanceOf(SetupError);
    await expect(r.render(OK)).rejects.toThrow(/找不到 PlantUML 命令[\s\S]*brew install plantuml graphviz[\s\S]*GOOD7OB_PLANTUML_CMD/);
  });

  it('rp-ucase-0051 refuses a PlantUML too old to be trusted with the profile, and one whose version it cannot read', async () => {
    tools.useCommand('plantuml');
    process.env.FAKE_VERSION = '1.2019.5';
    await expect(createRenderer().render(OK)).rejects.toThrow(/版本过低/);
    process.env.FAKE_VERSION = 'garbage';
    await expect(createRenderer().render(OK)).rejects.toThrow(/无法识别 PlantUML 版本/);
  });

  it('rp-ucase-0070 checks Java and Graphviz for a local install and lists everything missing at once', async () => {
    tools.useCommand('plantuml');
    tools.removeTool('java');
    tools.removeTool('dot');
    process.env.PATH = tools.onlyFakePath();
    const err = await createRenderer().render(OK).catch((e) => e);
    expect(err).toBeInstanceOf(SetupError);
    expect(err.message).toContain('找不到 Java');
    expect(err.message).toContain('Graphviz');
    expect(err.message).toContain('安装方法');
  });

  it('rp-ucase-0070 does not look for java / dot when PlantUML runs in a container', async () => {
    tools.useCommand('docker run --rm -i plantuml/plantuml:latest');
    tools.removeTool('java');
    tools.removeTool('dot');
    process.env.PATH = tools.onlyFakePath();
    await expect(createRenderer().render(OK)).resolves.toMatchObject({ version: '1.2026.8' });
  });

  it('rp-ucase-0053 has no hosted-service fallback: nothing in the module mentions plantuml.com', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'plantuml.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(src).not.toMatch(/plantuml\.com|http:\/\/|https:\/\//i);
  });

});

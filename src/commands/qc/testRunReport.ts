import path from 'path';
import { parseReportFile } from './pipeline';

/**
 * 测试报告的本地识别与预检（N-9 `test-run upload`，prd-0082 `rp-qc-test-0109`）。
 * 服务端仍会自己解析并以它为准；这里只做三件事：判断格式、上传前挡掉坏文件 / 超量、
 * 从 Playwright 报告里取出截图附件的路径，用来把截图对到用例。
 */

export type ReportFormat = 'playwright' | 'junit' | 'g7b';

/** 发给后端的 reportFormat 取值（N-9 §3.2）。 */
export const WIRE_FORMAT: Record<ReportFormat, string> = {
  playwright: 'playwright_json',
  junit: 'junit_xml',
  g7b: 'g7b_json',
};

export const REPORT_FORMATS: ReportFormat[] = ['playwright', 'junit', 'g7b'];

/** rp-qc-test-0117：单次 ≤ 2000 条结果。 */
export const MAX_RESULTS = 2000;

export interface CaseOutcome {
  /** 外部名称：Playwright 为 describe › 标题，JUnit 为 classname › name */
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  flaky?: boolean;
}

export interface ReportAttachment {
  /** 绝对路径（Playwright 写入报告的是执行机上的绝对路径） */
  path: string;
  caseName: string;
  titlePath: string[];
  specFile?: string;
  contentType?: string;
}

export interface ParsedReport {
  format: ReportFormat;
  cases: CaseOutcome[];
  stats: { total: number; passed: number; failed: number; skipped: number; flaky: number };
  attachments: ReportAttachment[];
}

const looksLikeJunit = (text: string) => /<testsuites?[\s>/]/.test(text.replace(/<\?xml[^>]*\?>/, '').replace(/<!--[\s\S]*?-->/g, '').trimStart().slice(0, 4096));

/**
 * 判断报告格式。显式 --format 优先；否则先看扩展名（.xml → junit），再嗅探内容：
 * JSON 含 suites → Playwright；数组或 { results: [{caseId}] } → g7b；XML 根为 testsuites/testsuite → JUnit。
 */
export function detectFormat(filePath: string, text: string, explicit?: string): ReportFormat {
  if (explicit) {
    const f = explicit.toLowerCase();
    if (!REPORT_FORMATS.includes(f as ReportFormat)) {
      throw new Error(`--format 只能是 ${REPORT_FORMATS.join(' / ')}，收到 ${explicit}`);
    }
    return f as ReportFormat;
  }
  const ext = path.extname(filePath).toLowerCase();
  const trimmed = text.trimStart();
  if (ext === '.xml' || trimmed.startsWith('<')) {
    if (looksLikeJunit(trimmed)) return 'junit';
    throw new Error('无法识别报告格式：XML 根元素不是 <testsuites> / <testsuite>（JUnit）');
  }
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('无法识别报告格式：既不是 JSON（Playwright / g7b）也不是 JUnit XML，可用 --format 指定');
  }
  if (json && !Array.isArray(json) && Array.isArray(json.suites)) return 'playwright';
  const list = Array.isArray(json) ? json : json?.results;
  if (Array.isArray(list) && list.length > 0 && list.every((x: any) => x && 'caseId' in x)) return 'g7b';
  throw new Error('无法识别报告格式：JSON 里既没有 Playwright 的 suites，也不是 g7b 的 [{caseId, result}]');
}

// ── Playwright JSON ────────────────────────────────────────────────

function playwrightStatus(test: any): CaseOutcome['status'] {
  switch (test?.status) {
    case 'unexpected':
      return 'failed';
    case 'skipped':
      return 'skipped';
    case 'expected':
    case 'flaky': {
      const last = (test.results ?? [])[test.results?.length - 1];
      return last?.status === 'skipped' ? 'skipped' : 'passed';
    }
    default: {
      // 老版本没有 test.status：看最后一次 result
      const last = (test?.results ?? [])[test?.results?.length - 1];
      if (!last) return 'skipped';
      if (last.status === 'passed') return 'passed';
      if (last.status === 'skipped') return 'skipped';
      return 'failed';
    }
  }
}

export function parsePlaywright(text: string): Omit<ParsedReport, 'stats'> {
  const json = JSON.parse(text);
  if (!json || !Array.isArray(json.suites)) throw new Error('不是 Playwright JSON 报告：缺少 suites');
  const cases: CaseOutcome[] = [];
  const attachments: ReportAttachment[] = [];

  const walk = (suite: any, titles: string[], file?: string) => {
    // 顶层 suite 的标题是文件名，不算进用例名
    const isFileSuite = titles.length === 0 && suite.file && suite.title === suite.file;
    const here = isFileSuite || !suite.title ? titles : [...titles, suite.title];
    const specFile = suite.file ?? file;
    for (const spec of suite.specs ?? []) {
      const titlePath = [...here, spec.title];
      for (const test of spec.tests ?? []) {
        const name = (test.projectName ? `[${test.projectName}] ` : '') + titlePath.join(' › ');
        cases.push({ name, status: playwrightStatus(test), flaky: test.status === 'flaky' || undefined });
        for (const result of test.results ?? []) {
          for (const a of result.attachments ?? []) {
            if (a?.path) {
              attachments.push({ path: a.path, caseName: name, titlePath, specFile: spec.file ?? specFile, contentType: a.contentType });
            }
          }
        }
      }
    }
    for (const child of suite.suites ?? []) walk(child, here, specFile);
  };
  for (const s of json.suites) walk(s, [], s.file);
  return { format: 'playwright', cases, attachments };
}

// ── JUnit XML ──────────────────────────────────────────────────────

const attr = (tag: string, name: string) => {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`));
  return m ? (m[2] ?? m[3]) : undefined;
};

export function parseJunit(text: string): Omit<ParsedReport, 'stats'> {
  if (!looksLikeJunit(text)) throw new Error('不是 JUnit XML：根元素应为 <testsuites> 或 <testsuite>');
  const cases: CaseOutcome[] = [];
  const re = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const open = m[1];
    const body = m[3] ?? '';
    const name = [attr(open, 'classname'), attr(open, 'name')].filter(Boolean).join(' › ') || '(unnamed)';
    const status: CaseOutcome['status'] = /<(failure|error)\b/.test(body) ? 'failed' : /<skipped\b/.test(body) ? 'skipped' : 'passed';
    cases.push({ name, status });
  }
  return { format: 'junit', cases, attachments: [] };
}

// ── g7b JSON（qc run report 的格式） ─────────────────────────────────

export function parseG7b(text: string): Omit<ParsedReport, 'stats'> {
  const list = parseReportFile(text) as any[];
  const cases = list.map((x) => {
    const r = String(x.result).toLowerCase();
    const status: CaseOutcome['status'] = r === 'passed' ? 'passed' : r === 'skipped' ? 'skipped' : 'failed';
    return { name: `case#${x.caseId}`, status };
  });
  return { format: 'g7b', cases, attachments: [] };
}

export function parseReport(filePath: string, text: string, explicit?: string): ParsedReport {
  const format = detectFormat(filePath, text, explicit);
  const parsed = format === 'playwright' ? parsePlaywright(text) : format === 'junit' ? parseJunit(text) : parseG7b(text);
  if (parsed.cases.length === 0) throw new Error('报告里没有任何用例结果');
  if (parsed.cases.length > MAX_RESULTS) {
    throw new Error(`报告含 ${parsed.cases.length} 条结果，超过单次上限 ${MAX_RESULTS} 条，请分批上传`);
  }
  const count = (s: CaseOutcome['status']) => parsed.cases.filter((c) => c.status === s).length;
  return {
    ...parsed,
    stats: {
      total: parsed.cases.length,
      passed: count('passed'),
      failed: count('failed'),
      skipped: count('skipped'),
      flaky: parsed.cases.filter((c) => c.flaky).length,
    },
  };
}

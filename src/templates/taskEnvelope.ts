/**
 * Task Context Envelope (任务上下文信封) Specification & Parser
 * Standard envelope format used for cross-agent collaboration and sufficiency evaluation.
 */

export interface TaskEnvelopeMetadata {
  envelopeVersion: string;
  deliveryLevel: 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
  targetRepo: string;
  slug: string;
  executorStrategy?: 'AGENT' | 'HYBRID' | 'HUMAN';
  upstreamAgent?: string;
  tags?: string[];
}

export interface TaskEnvelopeParsed {
  hasEnvelope: boolean;
  meta: Partial<TaskEnvelopeMetadata>;
  rawFrontmatter?: string;
  body: string;
  intent?: string;
  acceptanceCriteria: string[];
  deliverables: {
    prdPr?: string;
    wireframePr?: string;
    designPr?: string;
    testPr?: string;
  };
}

export interface SufficiencyCheckItem {
  key: string;
  name: string;
  passed: boolean;
  required: boolean;
  detail?: string;
}

export interface SufficiencyEvaluationResult {
  taskId?: number | string;
  sufficient: boolean;
  score: number; // 0-100
  deliveryLevel?: string;
  checks: SufficiencyCheckItem[];
  missingItems: string[];
  summary: string;
}

/**
 * Generate standard Markdown Task Envelope template
 */
export function generateEnvelopeTemplate(params: {
  name: string;
  slug: string;
  level?: string;
  intent?: string;
  targetRepo?: string;
  upstreamAgent?: string;
}): string {
  const level = params.level || 'L3';
  const targetRepo = params.targetRepo || 'front-web';
  const intent = params.intent || '明确该功能要解决的核心问题、现状与业务价值。';
  const agent = params.upstreamAgent || 'gemini-local';

  return `---
envelopeVersion: "1.0.0"
deliveryLevel: "${level}"
targetRepo: "${targetRepo}"
slug: "${params.slug}"
executorStrategy: "AGENT"
upstreamAgent: "${agent}"
---

## 1. 意图与业务背景 (Intent & Context)
- **核心问题**：${intent}
- **目标用户**：平台开发者 / 终端用户
- **业务价值**：提升自动化研发流转效率与确定性

## 2. 边界与非目标 (Scope & Boundaries)
- [x] **In-Scope**：${params.name} 核心功能实装与前置门禁验证
- [ ] **Out-of-Scope**：超出本次迭代范围的衍生需求

## 3. 验收条件 (Acceptance Criteria - Gherkin)
- **AC-01 (主功能验证)**:
  - *Given* 系统处于正常就绪状态
  - *When* 用户触发 ${params.name} 操作
  - *Then* 返回预期成功状态并产生确定的持久化数据或UI响应

## 4. 技术与契约约束 (Constraints & Contracts)
- **规范要求**：遵循良好工程实践，禁止硬编码凭证
- **分支规范**：基于 feat/${params.slug} 特性分支推进

## 5. 交付物追溯链接 (Deliverables)
- [ ] PRD PR: [待提交]
- [ ] Wireframe PR: [待提交]
- [ ] 详细设计 PR: [待提交]
- [ ] E2E 测试用例: [待提交]
`;
}

/**
 * Parse Markdown description containing YAML-like Frontmatter
 */
export function parseTaskEnvelope(description: string): TaskEnvelopeParsed {
  if (!description || typeof description !== 'string') {
    return {
      hasEnvelope: false,
      meta: {},
      body: '',
      acceptanceCriteria: [],
      deliverables: {},
    };
  }

  const fmMatch = description.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);

  if (!fmMatch) {
    return {
      hasEnvelope: false,
      meta: {},
      body: description.trim(),
      acceptanceCriteria: extractAcceptanceCriteria(description),
      deliverables: extractDeliverables(description),
    };
  }

  const rawFrontmatter = fmMatch[1];
  const body = fmMatch[2].trim();
  const meta: Partial<TaskEnvelopeMetadata> = {};

  // Simple key-value YAML parser for top-level keys
  const lines = rawFrontmatter.split(/\r?\n/);
  for (const line of lines) {
    const kv = line.match(/^([a-zA-Z0-9_]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    let val = kv[2].trim();
    // Strip quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }

    if (key === 'envelopeVersion' || key === 'version') meta.envelopeVersion = val;
    else if (key === 'deliveryLevel' || key === 'level') meta.deliveryLevel = val as any;
    else if (key === 'targetRepo' || key === 'repo') meta.targetRepo = val;
    else if (key === 'slug') meta.slug = val;
    else if (key === 'executorStrategy') meta.executorStrategy = val as any;
    else if (key === 'upstreamAgent') meta.upstreamAgent = val;
    else if (key === 'kind' && val.includes('task-envelope')) meta.envelopeVersion = meta.envelopeVersion || '1.0.0';
  }

  // Fallbacks from rawFrontmatter if not parsed in flat key-value
  if (!meta.envelopeVersion && rawFrontmatter.includes('task-envelope')) {
    meta.envelopeVersion = '1.0.0';
  }
  if (!meta.targetRepo && rawFrontmatter.match(/repo:\s*["']?([a-zA-Z0-9_\/-]+)["']?/i)) {
    const repoMatch = rawFrontmatter.match(/repo:\s*["']?([a-zA-Z0-9_\/-]+)["']?/i);
    if (repoMatch) {
      meta.targetRepo = repoMatch[1].replace(/^good7ob\//, '');
    }
  }
  if (!meta.slug && rawFrontmatter.match(/slug:\s*["']?([a-z0-9-]+)["']?/i)) {
    const slugMatch = rawFrontmatter.match(/slug:\s*["']?([a-z0-9-]+)["']?/i);
    if (slugMatch) {
      meta.slug = slugMatch[1];
    }
  }

  // Extract ACs from both frontmatter and body
  const bodyAcs = extractAcceptanceCriteria(body);
  const fmAcs: string[] = [];
  const acMatches = rawFrontmatter.match(/acceptance_criteria:\s*\n((?:\s*-\s*.*(?:\n|$))+)/);
  if (acMatches) {
    const acLines = acMatches[1].split(/\r?\n/);
    for (const l of acLines) {
      const item = l.replace(/^\s*-\s*["']?/, '').replace(/["']?\s*$/, '').trim();
      if (item && item.length > 5) fmAcs.push(item);
    }
  }

  const allAcs = fmAcs.length > 0 ? fmAcs : bodyAcs;

  return {
    hasEnvelope: !!meta.envelopeVersion,
    meta,
    rawFrontmatter,
    body,
    acceptanceCriteria: allAcs,
    deliverables: extractDeliverables(body + '\n' + rawFrontmatter),
  };
}

/**
 * Extract Gherkin Given/When/Then scenarios from markdown body
 */
function extractAcceptanceCriteria(text: string): string[] {
  const acList: string[] = [];
  const lines = text.split(/\r?\n/);
  let currentAc: string[] = [];
  let inAcSection = false;

  for (const line of lines) {
    if (line.includes('验收条件') || line.includes('Acceptance Criteria')) {
      inAcSection = true;
      continue;
    }
    if (inAcSection && line.startsWith('## ')) {
      // Exit section on next major header
      break;
    }
    if (inAcSection) {
      if (line.match(/AC-\d+/i) || line.startsWith('### ') || line.startsWith('- **AC')) {
        if (currentAc.length > 0) {
          acList.push(currentAc.join('\n').trim());
          currentAc = [];
        }
      }
      if (line.trim().length > 0) {
        currentAc.push(line);
      }
    }
  }

  if (currentAc.length > 0) {
    acList.push(currentAc.join('\n').trim());
  }

  return acList;
}

/**
 * Extract GitHub PR links from deliverables section or whole text
 */
function extractDeliverables(text: string): TaskEnvelopeParsed['deliverables'] {
  const deliverables: TaskEnvelopeParsed['deliverables'] = {};

  const prdMatch = text.match(/(?:prd.*?)https:\/\/github\.com\/[^\s/]+\/prd\/pull\/(\d+)/i);
  if (prdMatch) deliverables.prdPr = prdMatch[0];

  const wfMatch = text.match(/(?:wireframe.*?)https:\/\/github\.com\/[^\s/]+\/wireframe\/pull\/(\d+)/i);
  if (wfMatch) deliverables.wireframePr = wfMatch[0];

  const dsnMatch = text.match(/(?:design|详细设计.*?)https:\/\/github\.com\/[^\s/]+\/detailed-design-document\/pull\/(\d+)/i);
  if (dsnMatch) deliverables.designPr = dsnMatch[0];

  const testMatch = text.match(/(?:test|e2e|测试.*?)https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/(\d+)/i);
  if (testMatch) deliverables.testPr = testMatch[0];

  return deliverables;
}

/**
 * Evaluate task sufficiency for automated Agent execution
 */
export function evaluateTaskSufficiency(
  envelope: TaskEnvelopeParsed,
  taskId?: number | string
): SufficiencyEvaluationResult {
  const checks: SufficiencyCheckItem[] = [];
  const missingItems: string[] = [];

  // Check 1: Envelope Frontmatter Presence
  const hasFm = envelope.hasEnvelope;
  checks.push({
    key: 'envelope',
    name: '任务信封规范 (Task Context Envelope)',
    passed: hasFm,
    required: true,
    detail: hasFm ? `v${envelope.meta.envelopeVersion}` : '缺少标准 Frontmatter (---) 头部',
  });
  if (!hasFm) missingItems.push('标准任务信封 Frontmatter 头部');

  // Check 2: Delivery Level Validity (L1~L5)
  const validLevels = ['L1', 'L2', 'L3', 'L4', 'L5'];
  const levelPassed = !!envelope.meta.deliveryLevel && validLevels.includes(envelope.meta.deliveryLevel);
  checks.push({
    key: 'deliveryLevel',
    name: '目标交付等级 (deliveryLevel)',
    passed: levelPassed,
    required: true,
    detail: levelPassed ? envelope.meta.deliveryLevel : '未指定或非合法等级 (L1-L5)',
  });
  if (!levelPassed) missingItems.push('有效交付等级 (L1~L5)');

  // Check 3: Target Repository
  const repoPassed = !!envelope.meta.targetRepo && envelope.meta.targetRepo.length > 0;
  checks.push({
    key: 'targetRepo',
    name: '代码落点仓库 (targetRepo)',
    passed: repoPassed,
    required: true,
    detail: repoPassed ? envelope.meta.targetRepo : '未指定目标仓库',
  });
  if (!repoPassed) missingItems.push('目标落点仓库 (targetRepo)');

  // Check 4: Feature Slug
  const slugPassed = !!envelope.meta.slug && /^[a-z0-9-]+$/.test(envelope.meta.slug);
  checks.push({
    key: 'slug',
    name: '特性英文短链标识 (slug)',
    passed: slugPassed,
    required: true,
    detail: slugPassed ? envelope.meta.slug : '未指定或包含非法字符 (仅限小写字母/数字/中划线)',
  });
  if (!slugPassed) missingItems.push('合规特性标识 (slug)');

  // Check 5: Acceptance Criteria (AC)
  const hasAc = envelope.acceptanceCriteria.length > 0 || (envelope.body.includes('Given') && envelope.body.includes('Then'));
  checks.push({
    key: 'ac',
    name: '结构化验收标准 (Acceptance Criteria)',
    passed: hasAc,
    required: true,
    detail: hasAc ? `包含 ${envelope.acceptanceCriteria.length || 1} 条 AC 验收场景` : '未找到 Given-When-Then 验收准则',
  });
  if (!hasAc) missingItems.push('验收条件 AC (Given-When-Then)');

  // Calculate score
  const passedCount = checks.filter((c) => c.passed).length;
  const score = Math.round((passedCount / checks.length) * 100);
  const sufficient = missingItems.length === 0;

  return {
    taskId,
    sufficient,
    score,
    deliveryLevel: envelope.meta.deliveryLevel,
    checks,
    missingItems,
    summary: sufficient
      ? '任务上下文充分，通过前置体检，允许平台 Agent (Hermes) 自动化开工。'
      : `任务上下文不充分 (评分 ${score}/100)，缺少关键要素：${missingItems.join('、')}。请先补充完整，严禁盲目开工！`,
  };
}

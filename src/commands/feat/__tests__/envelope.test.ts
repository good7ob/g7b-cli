import { describe, it, expect } from 'vitest';
import {
  generateEnvelopeTemplate,
  parseTaskEnvelope,
  evaluateTaskSufficiency,
} from '../../../templates/taskEnvelope';

describe('Task Context Envelope & Sufficiency Evaluation', () => {
  it('generates standard envelope template with parameters', () => {
    const tpl = generateEnvelopeTemplate({
      name: '用户手机双因子认证',
      slug: '2fa-auth',
      level: 'L3',
      intent: '增强账号安全性',
      targetRepo: 'front-web',
    });

    expect(tpl).toContain('envelopeVersion: "1.0.0"');
    expect(tpl).toContain('deliveryLevel: "L3"');
    expect(tpl).toContain('slug: "2fa-auth"');
    expect(tpl).toContain('targetRepo: "front-web"');
    expect(tpl).toContain('## 1. 意图与业务背景');
    expect(tpl).toContain('## 3. 验收条件');
    expect(tpl).toContain('Given');
    expect(tpl).toContain('Then');
  });

  it('parses frontmatter and sections from task description', () => {
    const raw = `---
envelopeVersion: "1.0.0"
deliveryLevel: "L4"
targetRepo: "backend"
slug: "jwt-token-refresh"
executorStrategy: "AGENT"
---

## 1. 意图与业务背景
- 核心问题: JWT 过期后静默刷新

## 3. 验收条件 (Acceptance Criteria)
- **AC-01 (刷新成功)**:
  - *Given* Refresh Token 有效
  - *When* 请求刷新
  - *Then* 返回新 Access Token
`;

    const parsed = parseTaskEnvelope(raw);
    expect(parsed.hasEnvelope).toBe(true);
    expect(parsed.meta.envelopeVersion).toBe('1.0.0');
    expect(parsed.meta.deliveryLevel).toBe('L4');
    expect(parsed.meta.targetRepo).toBe('backend');
    expect(parsed.meta.slug).toBe('jwt-token-refresh');
    expect(parsed.meta.executorStrategy).toBe('AGENT');
    expect(parsed.acceptanceCriteria.length).toBeGreaterThan(0);
    expect(parsed.acceptanceCriteria[0]).toContain('Given');
  });

  it('evaluates task sufficiency as PASS when all hard requirements met', () => {
    const raw = generateEnvelopeTemplate({
      name: '支付结果对账',
      slug: 'reconciliation',
      level: 'L3',
      intent: '自动核对订单与流水',
      targetRepo: 'backend',
    });

    const parsed = parseTaskEnvelope(raw);
    const result = evaluateTaskSufficiency(parsed, 1200);

    expect(result.sufficient).toBe(true);
    expect(result.score).toBe(100);
    expect(result.missingItems).toHaveLength(0);
    expect(result.summary).toContain('通过前置体检');
  });

  it('evaluates task sufficiency as FAIL when missing deliveryLevel, slug, or AC', () => {
    const incompleteRaw = `---
envelopeVersion: "1.0.0"
---

## 1. 意图
随便写写，没有验收标准。
`;

    const parsed = parseTaskEnvelope(incompleteRaw);
    const result = evaluateTaskSufficiency(parsed, 1201);

    expect(result.sufficient).toBe(false);
    expect(result.score).toBeLessThan(100);
    expect(result.missingItems).toContain('有效交付等级 (L1~L5)');
    expect(result.missingItems).toContain('目标落点仓库 (targetRepo)');
    expect(result.missingItems).toContain('合规特性标识 (slug)');
    expect(result.missingItems).toContain('验收条件 AC (Given-When-Then)');
    expect(result.summary).toContain('任务上下文不充分');
  });

  it('extracts PR deliverable links from text', () => {
    const textWithPrs = `
## 5. 交付物追溯链接
- [x] PRD PR: https://github.com/good7ob/prd/pull/17
- [x] Wireframe PR: https://github.com/good7ob/wireframe/pull/8
- [x] 详细设计 PR: https://github.com/good7ob/detailed-design-document/pull/15
`;

    const parsed = parseTaskEnvelope(textWithPrs);
    expect(parsed.deliverables.prdPr).toContain('https://github.com/good7ob/prd/pull/17');
    expect(parsed.deliverables.wireframePr).toContain('https://github.com/good7ob/wireframe/pull/8');
    expect(parsed.deliverables.designPr).toContain('https://github.com/good7ob/detailed-design-document/pull/15');
  });
});

/**
 * Builds the `POST /forge/structuring/import` bodies (prd-0076 FP-9) from parsed docs/prd.
 * One body per PRD file: the server records the source as PRD number + document version + section,
 * so a file is the natural import unit. Pure — no network — so it can be unit tested.
 */

import { clip, fpStatusFor, mapFpType, mapRpType, NAME_MAX, ParsedStructure, rpImplStatusFor, Verified } from './structure';

export interface ImportRp { code: string; statement: string; rpType: string; implStatus: string; section?: string; line: number }
export interface ImportFp { code: string; name: string; fpType: string; description?: string; status: string; section?: string; line: number; rps: ImportRp[] }
export interface ImportFe { code: string; name: string; line?: number; fps: ImportFp[] }
export interface ImportPayload {
  tenantId?: number; productId?: number; prdNo: string; prdVersion: string; tool: string; dryRun: boolean; confirm?: boolean; features: ImportFe[];
}
export interface FilePayload { file: string; payload: ImportPayload }

const PRD_NO = /(?:^|\/)(prd-\d{4,})-[^/]*\.md$/;

export function buildImportPayloads(
  parsed: ParsedStructure, opts: { tenantId?: number; productId?: number; tool: string; dryRun: boolean; confirm?: boolean; verified?: Verified },
): { payloads: FilePayload[]; warnings: string[] } {
  const rowByFun = new Map(parsed.rows.map((r) => [r.funId, r]));
  const warnings: string[] = [];
  const byFile = new Map<string, ImportFe[]>();

  for (const prdFp of parsed.prdFps) {
    const row = rowByFun.get(prdFp.funId);
    if (!row) { warnings.push(`PRD 中的 ${prdFp.funId} 不在需求索引里，已跳过（含 ${prdFp.rps.length} 个 RP）`); continue; }
    const file = prdFp.file as string;
    const features = byFile.get(file) ?? [];
    byFile.set(file, features);
    let fe = features.find((f) => f.code === row.featureId);
    if (!fe) {
      fe = { code: row.featureId, name: clip(row.featureName, NAME_MAX), line: prdFp.line, fps: [] };
      features.push(fe);
    }
    fe.fps.push({
      code: prdFp.funId,
      name: clip(row.desc, NAME_MAX),
      fpType: mapFpType(prdFp.fpType),
      description: row.prdLink ? `来源：docs/prd/${row.prdLink.replace(/^\.\//, '')}` : undefined,
      status: fpStatusFor(row.funId, row.status, opts.verified),
      section: prdFp.section,
      line: prdFp.line,
      rps: prdFp.rps.map((rp) => ({
        code: rp.rpId, statement: rp.text, rpType: mapRpType(rp.type),
        implStatus: rpImplStatusFor(row.funId, rp.rpId, opts.verified), section: rp.section, line: rp.line,
      })),
    });
  }

  const payloads: FilePayload[] = [];
  for (const [file, features] of byFile) {
    const prdNo = file.match(PRD_NO)?.[1];
    const prdVersion = parsed.versions[file];
    if (!prdNo) throw new Error(`${file}: 文件名里没有 PRD 编号（应以 prd-NNNN- 开头），无法推导来源`);
    if (!prdVersion) throw new Error(`${file}: 没有找到文档版本（版本记录表里需要 | x.y.z | YYYY-MM-DD | 行），无法推导来源`);
    payloads.push({
      file,
      payload: { tenantId: opts.tenantId, productId: opts.productId, prdNo, prdVersion, tool: opts.tool, dryRun: opts.dryRun, ...(opts.confirm ? { confirm: true } : {}), features },
    });
  }
  return { payloads, warnings };
}

export function summarizePayloads(payloads: FilePayload[]) {
  const fes = payloads.flatMap((p) => p.payload.features);
  const fps = fes.flatMap((f) => f.fps);
  return { files: payloads.length, features: new Set(fes.map((f) => f.code)).size, fps: fps.length, rps: fps.reduce((n, fp) => n + fp.rps.length, 0) };
}

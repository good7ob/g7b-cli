/** Rendered template output (instance / upgrade preview / dry-run): a document body, or structured JSON. */

import { renderContent } from './renderVersion';

/** Document templates render to `{format, body}`; anything else has no top-level text body. */
export function documentBody(rendered: unknown): { format: string; body: string } | undefined {
  const doc = rendered as { format?: unknown; body?: unknown } | null;
  return doc && typeof doc === 'object' && typeof doc.body === 'string'
    ? { format: typeof doc.format === 'string' ? doc.format : 'text', body: doc.body }
    : undefined;
}

/** What `--out` writes: the document body itself, or the rendered JSON of a structured template. */
export function outText(rendered: unknown): string {
  return documentBody(rendered)?.body ?? JSON.stringify(rendered ?? null, null, 2);
}

/**
 * The rendered result for a terminal: a document body in full, structured content as its first lines, or (with
 * `writtenTo`) just a pointer to the file it went to. The body is untrusted text, sanitised by `emit`.
 */
export function resultLines(rendered: unknown, writtenTo?: string): string[] {
  if (writtenTo) return [`✓ 渲染结果已写入 ${writtenTo}`];
  const doc = documentBody(rendered);
  return doc ? [`渲染结果 (${doc.format}):`, doc.body] : renderContent(rendered, '渲染结果');
}

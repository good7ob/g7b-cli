/**
 * CLI-boundary validation for the `ui` commands (forge/uidesign). Limits mirror the V167 columns
 * and UiScreenService (platform / status / version-type whitelists, 10MB image-only UI_SCREENSHOT purpose).
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  InputError, checkMaxLength, parseId, parseIntInRange, requireOneOf, requireText,
} from '../../utils/cliHelpers';

export const PLATFORMS = ['web', 'ios', 'android', 'miniprogram', 'other'] as const;
export const SCREEN_STATUSES = ['active', 'deprecated', 'planned'] as const;
export const VERSION_TYPES = ['current', 'history', 'proposal'] as const;
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] as const;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_SORT = 1_000_000;

type Body = Record<string, string | number | boolean | null>;

/** Fields a PUT overwrites: the backend resets a null text field to "", so updates must resend them. */
const sortOf = (raw: string | undefined, label = '--sort') =>
  raw === undefined ? undefined : parseIntInRange(raw, label, 0, MAX_SORT);

function optText(raw: string | undefined, max: number, label: string): string | undefined {
  return raw === undefined ? undefined : checkMaxLength(raw, max, label);
}

/** Drop undefined so JSON bodies only carry what was asked for. */
function defined(body: Record<string, unknown>): Body {
  return Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) as Body;
}

export function buildAppBody(o: { org?: string; name?: string; platform?: string; description?: string; sort?: string }): Body {
  return defined({
    orgId: parseId(o.org, '--org'),
    name: requireText(o.name, 64, '--name'),
    platform: requireOneOf(o.platform ?? '', PLATFORMS, '--platform'),
    description: optText(o.description, 512, '--description'),
    sortOrder: sortOf(o.sort),
  });
}

interface ScreenFlags {
  name?: string; code?: string; route?: string; category?: string; status?: string; sort?: string; parent?: string; main?: boolean;
}
interface ScreenCurrent { name?: string; screenCode?: string | null; routePath?: string | null; category?: string | null; status?: string | null; sortOrder?: number | null }

/** `current` (update) supplies every field the flags leave out, because PUT overwrites them all. */
export function buildScreenBody(o: ScreenFlags, current?: ScreenCurrent): Body {
  const keep = <T>(flag: T | undefined, old: T | null | undefined): T | undefined => (flag !== undefined ? flag : old ?? undefined);
  return defined({
    name: requireText(keep(o.name, current?.name), 128, '--name'),
    screenCode: keep(optText(o.code, 64, '--code'), current?.screenCode),
    routePath: keep(optText(o.route, 256, '--route'), current?.routePath),
    category: keep(optText(o.category, 64, '--category'), current?.category),
    status: o.status !== undefined ? requireOneOf(o.status, SCREEN_STATUSES, '--status') : current?.status ?? undefined,
    sortOrder: keep(sortOf(o.sort), current?.sortOrder),
    ...screenTypeOf(o),
  });
}

/**
 * 子画面 (idea #168): --parent makes the screen a sub-screen of that main screen, --main detaches it.
 * With neither the body carries no screenType / parentScreenId and the backend keeps the current parent,
 * so (unlike the text fields) nothing has to be resent on update.
 */
function screenTypeOf(o: ScreenFlags): Body {
  if (o.parent !== undefined && o.main) throw new InputError('--parent 与 --main 不能同时使用');
  if (o.parent !== undefined) return { screenType: 'sub', parentScreenId: parseId(o.parent, '--parent') };
  return o.main ? { screenType: 'main' } : {};
}

interface VersionFlags { type?: string; label?: string; description?: string; active?: boolean }
interface VersionCurrent { versionType?: string; label?: string; description?: string | null; isActive?: boolean | null }

export function buildVersionBody(o: VersionFlags, current?: VersionCurrent): Body {
  const type = o.type ?? current?.versionType;
  return defined({
    versionType: requireOneOf(type ?? '', VERSION_TYPES, '--type'),
    label: requireText(o.label ?? current?.label, 128, '--label'),
    description: o.description !== undefined ? checkMaxLength(o.description, 512, '--description') : current?.description ?? undefined,
    isActive: o.active ?? undefined,
  });
}

interface FlowFlags { name?: string; description?: string; sort?: string }
interface FlowCurrent { name?: string; description?: string | null; sortOrder?: number | null }

export function buildFlowBody(o: FlowFlags, current?: FlowCurrent): Body {
  return defined({
    name: requireText(o.name ?? current?.name, 128, '--name'),
    description: o.description !== undefined ? checkMaxLength(o.description, 512, '--description') : current?.description ?? undefined,
    sortOrder: sortOf(o.sort) ?? current?.sortOrder ?? undefined,
  });
}

interface NodeFlags { from?: string; to?: string; trigger?: string; condition?: string; sort?: string; entry?: boolean }
interface NodeCurrent { fromScreenId?: number | null; toScreenId?: number | null; triggerDesc?: string | null; conditionDesc?: string | null; sortOrder?: number | null }

/** `--entry` marks an entry node (no from-screen); it excludes `--from`. */
export function buildNodeBody(o: NodeFlags, current?: NodeCurrent): Body {
  if (o.entry && o.from !== undefined) throw new InputError('--entry 与 --from 不能同时使用');
  const toRaw = o.to ?? (current?.toScreenId != null ? String(current.toScreenId) : undefined);
  let fromScreenId: number | null | undefined;
  if (o.entry) fromScreenId = null;
  else if (o.from !== undefined) fromScreenId = parseId(o.from, '--from');
  else fromScreenId = current?.fromScreenId ?? null;
  return defined({
    fromScreenId,
    toScreenId: parseId(toRaw, '--to'),
    triggerDesc: o.trigger !== undefined ? checkMaxLength(o.trigger, 256, '--trigger') : current?.triggerDesc ?? undefined,
    conditionDesc: o.condition !== undefined ? checkMaxLength(o.condition, 256, '--condition') : current?.conditionDesc ?? undefined,
    sortOrder: sortOf(o.sort) ?? current?.sortOrder ?? undefined,
  });
}

/** Image URL as stored: https, no whitespace / control chars, at most 1024 chars. */
export function checkImageUrl(raw: string | undefined, label: string): string {
  const url = requireText(raw, 1024, label).trim();
  if (!/^https:\/\/[^\s]+$/i.test(url) || /[\x00-\x1f\x7f]/.test(url)) {
    throw new InputError(`${label} 必须是 https 图片地址（不含空白字符），收到: ${url}`);
  }
  return url;
}

export interface ScreenshotFlags {
  file?: string[]; url?: string; thumbnail?: string; caption?: string; sort?: string;
}

export interface ScreenshotPlan {
  /** Local files to upload first, in order; empty when --url was given. */
  files: string[];
  /** Body for each registration, minus fileUrl for uploaded files. */
  base: { caption?: string; thumbnailUrl?: string; sortOrder?: number };
  url?: string;
}

/** A local image: exists, is a regular file, image extension, within the 10MB UI_SCREENSHOT limit. */
export function checkImageFile(file: string): string {
  const stat = fs.existsSync(file) ? fs.statSync(file) : undefined;
  if (!stat || !stat.isFile()) throw new InputError(`--file 不是可读文件: ${file}`);
  const ext = path.extname(file).slice(1).toLowerCase();
  if (!(IMAGE_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new InputError(`--file 只支持图片 (${IMAGE_EXTENSIONS.join('/')})，收到: ${file}`);
  }
  if (stat.size === 0) throw new InputError(`--file 是空文件: ${file}`);
  if (stat.size > MAX_IMAGE_BYTES) {
    throw new InputError(`--file 超过 10MB 上限 (${(stat.size / 1048576).toFixed(1)}MB): ${file}`);
  }
  return file;
}

export function planScreenshots(o: ScreenshotFlags): ScreenshotPlan {
  const files = o.file ?? [];
  if (files.length === 0 && o.url === undefined) throw new InputError('需要 --file <图片路径>（可重复）或 --url <https 地址> 之一');
  if (files.length > 0 && o.url !== undefined) throw new InputError('--file 与 --url 不能同时使用');
  if (files.length > 1 && (o.thumbnail !== undefined || o.caption !== undefined)) {
    throw new InputError('多个 --file 时不能共用 --caption / --thumbnail，请分次添加');
  }
  return {
    files: files.map(checkImageFile),
    url: o.url === undefined ? undefined : checkImageUrl(o.url, '--url'),
    base: defined({
      caption: optText(o.caption, 256, '--caption'),
      thumbnailUrl: o.thumbnail === undefined ? undefined : checkImageUrl(o.thumbnail, '--thumbnail'),
      sortOrder: sortOf(o.sort),
    }) as ScreenshotPlan['base'],
  };
}

export const PREVIEW_EXTENSIONS = ['html', 'htm', 'svg', 'png', 'zip'] as const;
/** Mirrors PreviewPackageReader.MAX_FILE_BYTES (10MB) and PreviewThumbnails.MAX_SOURCE_BYTES (5MB). */
export const MAX_PREVIEW_BYTES = 10 * 1024 * 1024;
export const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024;

function checkLocalFile(file: string | undefined, label: string, exts: readonly string[], max: number): string {
  const f = requireText(file, 1024, label);
  const stat = fs.existsSync(f) ? fs.statSync(f) : undefined;
  if (!stat || !stat.isFile()) throw new InputError(`${label} 不是可读文件: ${f}`);
  if (!exts.includes(path.extname(f).slice(1).toLowerCase())) {
    throw new InputError(`${label} 只支持 ${exts.join('/')}，收到: ${f}`);
  }
  if (stat.size === 0) throw new InputError(`${label} 是空文件: ${f}`);
  if (stat.size > max) throw new InputError(`${label} 超过 ${max / 1048576}MB 上限 (${(stat.size / 1048576).toFixed(1)}MB): ${f}`);
  return f;
}

export interface PreviewFlags {
  org?: string; name?: string; file?: string; screen?: string; product?: string;
  description?: string; note?: string; thumbnail?: string;
}

export interface PreviewPlan { file: string; thumbnail?: string; fields: Record<string, string> }

/** Validate `ui preview add` input; fields are the multipart text parts of POST /api/v1/ui-previews. */
export function planPreview(o: PreviewFlags): PreviewPlan {
  const fields: Record<string, string> = {
    orgId: String(parseId(o.org, '--org')),
    name: requireText(o.name, 128, '--name'),
  };
  const optional: [string, string | undefined][] = [
    ['screenId', o.screen === undefined ? undefined : String(parseId(o.screen, '--screen'))],
    ['productId', o.product === undefined ? undefined : String(parseId(o.product, '--product'))],
    ['description', optText(o.description, 1000, '--description')],
    ['note', optText(o.note, 500, '--note')],
  ];
  optional.forEach(([k, v]) => { if (v !== undefined) fields[k] = v; });
  return {
    file: checkLocalFile(o.file, '--file', PREVIEW_EXTENSIONS, MAX_PREVIEW_BYTES),
    thumbnail: o.thumbnail === undefined ? undefined : checkLocalFile(o.thumbnail, '--thumbnail', ['png'], MAX_THUMBNAIL_BYTES),
    fields,
  };
}

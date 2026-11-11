/**
 * JSON parsing that keeps 64-bit ids exact.
 *
 * The backend's ids are snowflakes (e.g. 2119699347172331521), beyond Number.MAX_SAFE_INTEGER.
 * Entities send them as strings, but a bare `Long` (e.g. `Result.ok(app.getId())` of
 * `POST /api/infra/applications`) still arrives as a JSON number, and JSON.parse rounds it
 * (…331521 → …331500). Here every integer literal outside the safe range becomes a string
 * holding its exact digits, so the CLI prints and reuses the id verbatim. Safe integers and
 * decimals stay numbers.
 */

const isDigit = (c: number) => c >= 48 && c <= 57; // 0-9

/** A JSON number token may contain digits, '-', '+', '.', 'e' and 'E'. */
const isNumberChar = (c: number) => isDigit(c) || c === 45 || c === 43 || c === 46 || c === 101 || c === 69;

/** Rewrite the raw JSON text so that unsafe integer literals are quoted. Strings are left untouched. */
export function quoteUnsafeIntegers(text: string): string {
  // fast path: an unsafe integer needs at least 16 digits in a row
  if (!/\d{16}/.test(text)) return text;

  let out = '';
  let last = 0;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text.charCodeAt(i);
    if (c === 34) {
      // string literal: skip to the closing quote, honouring backslash escapes
      i++;
      while (i < n) {
        const d = text.charCodeAt(i);
        if (d === 92) i += 2;
        else if (d === 34) {
          i++;
          break;
        } else i++;
      }
      continue;
    }
    if (c === 45 || isDigit(c)) {
      const start = i;
      i++;
      while (i < n && isNumberChar(text.charCodeAt(i))) i++;
      const token = text.slice(start, i);
      if (/^-?\d{16,}$/.test(token) && !Number.isSafeInteger(Number(token))) {
        out += `${text.slice(last, start)}"${token}"`;
        last = i;
      }
      continue;
    }
    i++;
  }
  return last === 0 ? text : out + text.slice(last);
}

/** JSON.parse, except that integers beyond Number.MAX_SAFE_INTEGER come back as exact strings. */
export function parseJsonKeepingLongIds(text: string): any {
  return JSON.parse(quoteUnsafeIntegers(text));
}

/**
 * axios `transformResponse` replacing the default JSON parsing: same lenient behaviour
 * (a body that is not JSON is handed back as text), but long ids keep every digit.
 */
export function longSafeTransformResponse(this: { responseType?: string } | undefined, data: unknown): unknown {
  const responseType = this?.responseType;
  if (typeof data !== 'string' || data.trim() === '' || (responseType && responseType !== 'json')) {
    return data;
  }
  try {
    return parseJsonKeepingLongIds(data);
  } catch {
    return data;
  }
}

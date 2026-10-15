/**
 * Shapes of MCP tool results: stable error codes the skills can branch on, and a size cap so a big
 * report never floods the model's context.
 */

export type ErrorCode = 'AUTH_FAILED' | 'NO_OCAPI' | 'NOT_FOUND' | 'INVALID_INPUT' | 'BLOCKED_BY_SAFETY' | 'CONFIG_ERROR' | 'NETWORK' | 'INTERNAL';

const RULES: Array<[ErrorCode, RegExp]> = [
  ['BLOCKED_BY_SAFETY', /safety|blocked by|READ_ONLY/i],
  ['CONFIG_ERROR', /No dw\.json|Incomplete instance configuration|No hostname for instance|client-id and client-secret/i],
  ['INVALID_INPUT', /Only paths under|id is required|No instance: pass|pass --code-version|must be|Invalid (input|arguments)|expected .* received/i],
  ['AUTH_FAILED', /\b(401|403)\b|unauthori[sz]ed|forbidden|invalid[_ ]client|invalid[_ ]grant|authentication failed/i],
  ['NO_OCAPI', /ocapi.*(\b404\b|not (configured|available|enabled)|permission|no .*settings)|no ocapi/i],
  ['NOT_FOUND', /not found|\b404\b|no such|ENOENT/i],
  ['NETWORK', /ETIMEDOUT|ECONN\w+|ENOTFOUND|EAI_AGAIN|timed? ?out|fetch failed|socket hang up/i],
];

export function classifyError(error: unknown): {code: ErrorCode; message: string} {
  const message = error instanceof Error ? error.message : String(error);
  const code = RULES.find(([, re]) => re.test(message))?.[0] ?? 'INTERNAL';
  return {code, message};
}

/** `Error [CODE]: message`: readable as text, and the code is always in the same place. */
export function errorText(error: unknown): string {
  const {code, message} = classifyError(error);
  return `Error [${code}]: ${message}`;
}

export const MAX_RESPONSE_CHARS = 120_000;

/**
 * Keeps a JSON result under maxChars. Reports are cut in a fixed order (long arrays in `data`, then
 * the lowest-severity findings last) and the cut is declared in `notes` and `truncated`.
 */
export function limitResponse(value: unknown, maxChars = MAX_RESPONSE_CHARS): unknown {
  if (JSON.stringify(value).length <= maxChars) return value;
  const copy = structuredClone(value) as Record<string, unknown>;
  const notes: string[] = [];
  const size = () => JSON.stringify(copy).length;

  const data = copy.data as Record<string, unknown> | undefined;
  if (data && typeof data === 'object') {
    for (const [k, v] of Object.entries(data)) {
      if (Array.isArray(v) && v.length > 10 && size() > maxChars) {
        data[k] = v.slice(0, 10);
        notes.push(`data.${k} cut to 10 of ${v.length} items.`);
      }
    }
  }
  const findings = copy.findings as unknown[] | undefined;
  if (Array.isArray(findings)) {
    const total = findings.length;
    // findings are sorted most severe first: drop from the end
    while (findings.length > 5 && size() > maxChars) findings.length = Math.max(5, Math.floor(findings.length * 0.7));
    if (findings.length < total) notes.push(`findings cut to ${findings.length} of ${total} (most severe kept). Use maxFindings or offset, or narrow the scope.`);
  }
  if (size() > maxChars && typeof copy.content === 'string') {
    const original = copy.content.length;
    copy.content = copy.content.slice(-Math.max(1000, maxChars - 2000));
    notes.push(`content cut to its last ${(copy.content as string).length} of ${original} characters.`);
  }
  copy.truncated = true;
  copy.notes = [...(Array.isArray(copy.notes) ? (copy.notes as string[]) : []), ...notes, `Response was over ${maxChars} characters and has been reduced.`];
  return copy;
}

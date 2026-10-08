/**
 * Parser for B2C Commerce log files.
 *
 * Entry format (first line):
 *   [2026-10-08 10:12:33.123 GMT] ERROR PipelineCallServlet|1234|Sites-RefArch-Site|Cart-AddProduct|PipelineCall|sessId custom.cart [] - message
 * Continuation lines (stack traces, details) follow until the next "[timestamp]" line.
 */

export interface ParsedEntry {
  file: string;
  /** ISO timestamp (UTC) or undefined when the line has none */
  timestamp?: string;
  level?: string;
  /** Request context, when present */
  site?: string;
  pipeline?: string;
  /** Message without the thread/session header */
  message: string;
  /** Continuation lines */
  details: string[];
}

const ENTRY_START = /^\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?) (\w+)\]\s*(.*)$/;
const LEVEL = /^(FATAL|ERROR|WARN|INFO|DEBUG|TRACE)\s+(.*)$/s;
// thread|threadId|site|pipeline|type|session  category  [...]  - message
const HEADER =
  /^([^\s|]+)\|(\d+)\|([^|]*)\|([^|]*)\|([^|]*)\|(\S*)\s*(.*)$/s;

export function parseLogText(text: string, file: string): ParsedEntry[] {
  const lines = text.split(/\r?\n/);
  const entries: ParsedEntry[] = [];
  let current: ParsedEntry | undefined;

  for (const line of lines) {
    const m = ENTRY_START.exec(line);
    if (m) {
      if (current) entries.push(current);
      current = parseFirstLine(m, file);
    } else if (current) {
      if (line.trim() !== '') current.details.push(line);
    }
    // Lines before the first entry are ignored (partial file reads).
  }
  if (current) entries.push(current);
  return entries;
}

function parseFirstLine(m: RegExpExecArray, file: string): ParsedEntry {
  const [, date, time, tz, rest] = m;
  const timestamp = tz === 'GMT' || tz === 'UTC' ? `${date}T${time}Z` : `${date}T${time}`;
  const entry: ParsedEntry = {file, timestamp, message: rest.trim(), details: []};

  const lv = LEVEL.exec(rest);
  if (!lv) return entry;
  entry.level = lv[1];
  let body = lv[2];

  const h = HEADER.exec(body);
  if (h) {
    const site = h[3].trim();
    const pipeline = h[4].trim();
    if (site) entry.site = site;
    if (pipeline) entry.pipeline = pipeline;
    body = h[7];
  }
  // Drop "category []" prefix up to the " - " separator when present.
  const sep = body.indexOf(' - ');
  if (sep >= 0 && sep < 200) body = body.slice(sep + 3);
  entry.message = body.trim();
  return entry;
}

const CODE_REF = /([A-Za-z0-9_.-]+\/cartridge\/[^\s:()'"<>]+?\.(?:js|ds|isml|xml))(?:[:#](\d+))?/g;

/** Extracts cartridge file references (file:line) from a message and its details. */
export function extractCodeRefs(entry: ParsedEntry): string[] {
  const text = [entry.message, ...entry.details].join('\n');
  const refs = new Set<string>();
  for (const m of text.matchAll(CODE_REF)) {
    refs.add(m[2] ? `${m[1]}:${m[2]}` : m[1]);
  }
  return [...refs];
}

/** Log file names end with the date: error-blade1-0-appserver-20261008.log */
export function dateFromLogFileName(name: string): string | undefined {
  const m = /(\d{4})(\d{2})(\d{2})(?:\.log|\.txt|\.csv|$)/.exec(name) ?? /-(\d{4})(\d{2})(\d{2})/.exec(name);
  if (!m) return undefined;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

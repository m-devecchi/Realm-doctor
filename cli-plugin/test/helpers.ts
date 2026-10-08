import {readFileSync, readdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseLogText, type ParsedEntry} from '../src/lib/logparse.js';

export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

export function loadLogs(prefix: string): ParsedEntry[] {
  const dir = join(FIXTURES, 'logs');
  return readdirSync(dir)
    .filter((n) => n.startsWith(prefix))
    .sort()
    .flatMap((n) => parseLogText(readFileSync(join(dir, n), 'utf8'), n));
}

export function rules(findings: Array<{rule: string}>): string[] {
  return findings.map((f) => f.rule).sort();
}

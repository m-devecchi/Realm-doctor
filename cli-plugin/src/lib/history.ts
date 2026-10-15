/**
 * Saved reports, so a run can be compared with the previous one. Stored in the cache (user-only permissions),
 * without the bulky `data` part: findings, target and summary only. Best effort: a failure never fails an audit.
 */
import {mkdir, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {hostDir} from './cache.js';
import {addNotice} from './notices.js';
import type {Report} from './report.js';

const KEEP = 20;
const dirFor = (hostname: string, command: string) => join(hostDir(hostname), 'reports', command.replace(/[^a-z0-9]+/gi, '-'));

export async function saveReport(hostname: string, report: Report): Promise<void> {
  try {
    const dir = dirFor(hostname, report.command);
    await mkdir(dir, {recursive: true, mode: 0o700});
    const {data: _data, ...light} = report;
    await writeFile(join(dir, `${report.generatedAt.replace(/[:.]/g, '-')}.json`), JSON.stringify(light), {mode: 0o600});
    const names = (await readdir(dir)).sort();
    for (const old of names.slice(0, Math.max(0, names.length - KEEP))) await rm(join(dir, old), {force: true});
  } catch (error) {
    addNotice(`Report history not saved (${(error as NodeJS.ErrnoException)?.code ?? String(error)}): "compare_runs" will not see this run.`);
  }
}

/** The two most recent saved reports of a command on a host: [previous, latest]. */
export async function lastTwoReports(hostname: string, command: string): Promise<Array<Omit<Report, 'data'>>> {
  const dir = dirFor(hostname, command);
  let names: string[];
  try {
    names = (await readdir(dir)).sort().slice(-2);
  } catch {
    return [];
  }
  return Promise.all(names.map(async (n) => JSON.parse(await readFile(join(dir, n), 'utf8')) as Omit<Report, 'data'>));
}

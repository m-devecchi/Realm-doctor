import {createHash} from 'node:crypto';
import {mkdir, readFile, rm, stat, writeFile, readdir} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

/**
 * Local cache inside the repository: <repo>/.cache/realm-doctor/<host>/ (override with REALM_DOCTOR_CACHE).
 * Nothing is written outside the repository folder.
 * Only masked log text and code snapshots are stored. Files are user-readable only.
 */
export function cacheRoot(): string {
  // this file lives in <repo>/cli-plugin/{src,dist}/lib/
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  return process.env.REALM_DOCTOR_CACHE ?? join(repoRoot, '.cache', 'realm-doctor');
}

export function hostDir(hostname: string): string {
  return join(cacheRoot(), hostname.replace(/[^A-Za-z0-9.-]/g, '_'));
}

export async function readCached(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

export async function writeCached(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), {recursive: true, mode: 0o700});
  await writeFile(path, content, {mode: 0o600});
}

export function keyFor(...parts: Array<string | number | undefined>): string {
  return createHash('sha1').update(parts.map(String).join('|')).digest('hex').slice(0, 16);
}

/** Deletes cached log files older than maxAgeDays. */
export async function pruneLogs(hostname: string, maxAgeDays = 30): Promise<number> {
  const dir = join(hostDir(hostname), 'logs');
  let removed = 0;
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return 0;
  }
  const limit = Date.now() - maxAgeDays * 86_400_000;
  for (const n of names) {
    const p = join(dir, n);
    const st = await stat(p);
    if (st.mtimeMs < limit) {
      await rm(p, {force: true});
      removed++;
    }
  }
  return removed;
}

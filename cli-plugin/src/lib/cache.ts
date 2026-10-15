import {createHash} from 'node:crypto';
import {mkdir, readFile, rm, stat, writeFile, readdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join} from 'node:path';
import {addNotice} from './notices.js';
import {fileURLToPath} from 'node:url';

/**
 * Cache location:
 * - REALM_DOCTOR_CACHE when set;
 * - in a clone of the repository: <repo>/.cache/realm-doctor (nothing is written outside the folder);
 * - installed by npx or as a plugin: ${CLAUDE_PLUGIN_DATA}/cache, else ~/.cache/realm-doctor.
 * Only masked log text and code snapshots are stored. Files are user-readable only.
 */
export function cacheRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (env.REALM_DOCTOR_CACHE) return env.REALM_DOCTOR_CACHE;
  // this file lives in <package>/cli-plugin/{src,dist}/lib/
  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  if (existsSync(join(packageRoot, '.git'))) return join(packageRoot, '.cache', 'realm-doctor');
  if (env.CLAUDE_PLUGIN_DATA) return join(env.CLAUDE_PLUGIN_DATA, 'cache');
  return join(env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'realm-doctor');
}

export function hostDir(hostname: string): string {
  return join(cacheRoot(), hostname.replace(/[^A-Za-z0-9.-]/g, '_'));
}


const note = (action: string, path: string, error: unknown): void => {
  const code = (error as NodeJS.ErrnoException)?.code ?? (error instanceof Error ? error.message : String(error));
  addNotice(`Cache ${action} failed (${code}) under ${dirname(dirname(path))}: results are correct but slower; check the folder permissions.`);
};

/** A missing file is a normal cache miss; any other error is reported in the notes. */
export async function readCached(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') note('read', path, error);
    return undefined;
  }
}

/** Best effort: a cache that cannot be written never fails an audit. */
export async function writeCached(path: string, content: string): Promise<void> {
  try {
    await mkdir(dirname(path), {recursive: true, mode: 0o700});
    await writeFile(path, content, {mode: 0o600});
  } catch (error) {
    note('write', path, error);
  }
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

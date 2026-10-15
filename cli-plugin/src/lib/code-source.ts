import type {B2CInstance} from '@salesforce/b2c-tooling-sdk';
import {drainCacheWarnings} from './cache.js';
import {fetchCodeVersion, getActiveCodeVersionId} from './sfcc.js';
import {loadLocalSources, type SourceFile} from '../rules/source.js';

export interface LoadedCode {
  origin: 'local' | 'instance';
  codeVersion?: string;
  root?: string;
  files: SourceFile[];
  notes: string[];
}

/** Loads code either from a local folder (--dir) or from the instance's code version. */
export async function loadCode(
  opts: {dir?: string; codeVersion?: string; cartridges?: string[]},
  instanceFactory: () => {instance: B2CInstance; hostname: string},
): Promise<LoadedCode> {
  if (opts.dir) {
    const skipped: string[] = [];
    let files = await loadLocalSources(opts.dir, skipped);
    if (opts.cartridges?.length) files = files.filter((f) => opts.cartridges!.some((c) => f.path.startsWith(`${c}/`) || f.path.includes(`/${c}/`)));
    const notes = skipped.length ? [`${skipped.length} file(s) over 1 MB were NOT analyzed: ${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? ', ...' : ''}.`] : [];
    return {origin: 'local', root: opts.dir, files, notes};
  }
  const {instance, hostname} = instanceFactory();
  const codeVersion = opts.codeVersion ?? (await getActiveCodeVersionId(instance));
  if (!codeVersion) throw new Error('No active code version found: pass --code-version.');
  const res = await fetchCodeVersion(instance, hostname, {codeVersion, cartridges: opts.cartridges});
  const notes = [`Code version ${codeVersion}: ${res.files.length} files analyzed in ${res.cartridges.length} cartridges (${res.fromCache} from cache).`];
  if (res.files.length === 0) notes.push('No files read: check WebDAV read permissions on /Cartridges.');
  notes.push(...drainCacheWarnings());
  return {origin: 'instance', codeVersion, files: res.files, notes};
}

import type {B2CInstance} from '@salesforce/b2c-tooling-sdk';
import {drainNotices} from './notices.js';
import {fetchCodeVersion, getActiveCodeVersionId} from './sfcc.js';
import {cartridgeOf, isBaseCartridge, loadLocalSources, type SourceFile} from '../rules/source.js';

export interface LoadedCode {
  origin: 'local' | 'instance';
  codeVersion?: string;
  root?: string;
  files: SourceFile[];
  notes: string[];
}

/** Loads code either from a local folder (--dir) or from the instance's code version. */
export async function loadCode(
  opts: {dir?: string; codeVersion?: string; cartridges?: string[]; includeBase?: boolean},
  instanceFactory: () => {instance: B2CInstance; hostname: string},
): Promise<LoadedCode> {
  if (opts.dir) {
    const skipped: string[] = [];
    let files = await loadLocalSources(opts.dir, skipped);
    const notes: string[] = [];
    if (!opts.includeBase && !opts.cartridges?.length) {
      const base = files.filter((f) => isBaseCartridge(cartridgeOf(f.path)));
      if (base.length) {
        files = files.filter((f) => !isBaseCartridge(cartridgeOf(f.path)));
        notes.push(`${base.length} file(s) in base cartridges (app_storefront_base, modules, bm_*) were not analyzed; pass includeBase to include them.`);
      }
    }
    if (opts.cartridges?.length) files = files.filter((f) => opts.cartridges!.some((c) => f.path.startsWith(`${c}/`) || f.path.includes(`/${c}/`)));
    if (skipped.length) notes.push(`${skipped.length} file(s) over 1 MB were NOT analyzed: ${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? ', ...' : ''}.`);
    return {origin: 'local', root: opts.dir, files, notes};
  }
  const {instance, hostname} = instanceFactory();
  const codeVersion = opts.codeVersion ?? (await getActiveCodeVersionId(instance));
  if (!codeVersion) throw new Error('No active code version found: pass --code-version.');
  const res = await fetchCodeVersion(instance, hostname, {codeVersion, cartridges: opts.cartridges, excludeBase: !opts.includeBase});
  const notes = [`Code version ${codeVersion}: ${res.files.length} files analyzed in ${res.cartridges.length} cartridges (${res.fromCache} from cache).`];
  if (res.excluded.length) notes.push(`Base cartridges not downloaded: ${res.excluded.join(', ')}; pass includeBase to include them.`);
  if (res.files.length === 0) notes.push('No files read: check WebDAV read permissions on /Cartridges.');
  notes.push(...drainNotices());
  return {origin: 'instance', codeVersion, files: res.files, notes};
}

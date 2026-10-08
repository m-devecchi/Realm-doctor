import type {B2CInstance} from '@salesforce/b2c-tooling-sdk';
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
    let files = await loadLocalSources(opts.dir);
    if (opts.cartridges?.length) files = files.filter((f) => opts.cartridges!.some((c) => f.path.startsWith(`${c}/`) || f.path.includes(`/${c}/`)));
    return {origin: 'local', root: opts.dir, files, notes: []};
  }
  const {instance, hostname} = instanceFactory();
  const codeVersion = opts.codeVersion ?? (await getActiveCodeVersionId(instance));
  if (!codeVersion) throw new Error('Nessuna code version attiva trovata: indicare --code-version.');
  const res = await fetchCodeVersion(instance, hostname, {codeVersion, cartridges: opts.cartridges});
  const notes = [`Code version ${codeVersion}: ${res.files.length} file analizzati in ${res.cartridges.length} cartridge (${res.fromCache} dalla cache).`];
  if (res.files.length === 0) notes.push('Nessun file letto: verificare i permessi WebDAV in lettura su /Cartridges.');
  return {origin: 'instance', codeVersion, files: res.files, notes};
}

/**
 * Read-only data access to a B2C Commerce instance through the official SDK.
 * WebDAV: GET / PROPFIND / ranged GET. Code versions, jobs and promotions: SCAPI Admin APIs first
 * (instances with short-code and tenant-id), OCAPI Data API as fallback, like the official CLI
 * (`api-backend` auto | scapi | ocapi in dw.json). Only GETs and searches: nothing is written.
 */
import type {B2CInstance} from '@salesforce/b2c-tooling-sdk';
import {BackendDispatcher} from '@salesforce/b2c-tooling-sdk/cli';
import {createScapiJobsClient} from '@salesforce/b2c-tooling-sdk/clients';
import {createScriptsBackend} from '@salesforce/b2c-tooling-sdk/operations/code';
import {
  mapCanonicalToOcapiExecution,
  mapOcapiSearchResult,
  scapiSearchJobExecutions,
  searchJobExecutions,
} from '@salesforce/b2c-tooling-sdk/operations/jobs';
import {listLogFiles} from '@salesforce/b2c-tooling-sdk/operations/logs';
import {join} from 'node:path';
import {hostDir, keyFor, readCached, writeCached} from './cache.js';
import {dateFromLogFileName, parseLogText, type ParsedEntry} from './logparse.js';
import {maskPII} from './mask.js';
import {isAnalyzed, type SourceFile} from '../rules/source.js';
import type {Assignment, Campaign, Coupon, CustomerGroup, PromoBundle, Promotion} from '../rules/promo-rules.js';
import type {JobExecution} from './jobs.js';
import {fetchPromoBundleScapi} from './scapi-promotions.js';

/** Which API answered: SCAPI (Admin APIs) or OCAPI (Data API). */
export type Backend = 'scapi' | 'ocapi';

export interface LogFetchOptions {
  prefixes: string[];
  /** ISO date-time: files last modified before are skipped */
  since: Date;
  /** read at most this many bytes from the end of each file (default 20 MB) */
  maxBytesPerFile?: number;
  /** cap on the number of files (newest first, default 200) */
  maxFiles?: number;
  /** today's date YYYY-MM-DD (UTC), files of past days are cached */
  today?: string;
}

export interface LogFetchResult {
  entries: ParsedEntry[];
  files: Array<{name: string; size: number; truncated: boolean; cached: boolean}>;
}

export async function fetchLogEntries(instance: B2CInstance, hostname: string, options: LogFetchOptions): Promise<LogFetchResult> {
  const maxBytes = options.maxBytesPerFile ?? 20 * 1024 * 1024;
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const sinceDay = options.since.toISOString().slice(0, 10);

  const all = await listLogFiles(instance, {prefixes: options.prefixes, sortBy: 'date', sortOrder: 'desc'});
  const candidates = all
    .filter((f) => {
      const day = dateFromLogFileName(f.name);
      if (day) return day >= sinceDay;
      return f.lastModified.getTime() >= options.since.getTime();
    })
    .slice(0, options.maxFiles ?? 200);

  const result: LogFetchResult = {entries: [], files: []};
  for (const f of candidates) {
    const day = dateFromLogFileName(f.name);
    const cacheable = day !== undefined && day < today;
    const cachePath = join(hostDir(hostname), 'logs', `${f.name.replace(/\//g, '__')}.${keyFor(f.size, f.lastModified.getTime(), maxBytes)}.masked`);
    let text = cacheable ? await readCached(cachePath) : undefined;
    const cached = text !== undefined;
    let truncated = false;
    if (text === undefined) {
      let raw: string;
      if (f.size > maxBytes) {
        truncated = true;
        const res = await instance.webdav.request(f.path, {method: 'GET', headers: {Range: `bytes=${f.size - maxBytes}-`}});
        if (!res.ok && res.status !== 206) throw new Error(`WebDAV GET ${f.path} failed: ${res.status}`);
        raw = await res.text();
      } else {
        raw = new TextDecoder().decode(await instance.webdav.get(f.path));
      }
      text = maskPII(raw);
      if (cacheable) await writeCached(cachePath, text);
    }
    result.files.push({name: f.name, size: f.size, truncated, cached});
    result.entries.push(...parseLogText(text, f.name));
  }
  return result;
}

export interface CodeFetchOptions {
  codeVersion: string;
  /** only these cartridges (default: all) */
  cartridges?: string[];
  concurrency?: number;
}

export interface CodeFetchResult {
  codeVersion: string;
  cartridges: string[];
  files: SourceFile[];
  fromCache: number;
}

/**
 * Downloads analyzable files of a code version with PROPFIND + GET only.
 * The SDK's downloadCartridges() is NOT used on purpose: it zips on the server
 * (POST + DELETE), which a READ_ONLY safety policy blocks.
 */
export async function fetchCodeVersion(instance: B2CInstance, hostname: string, options: CodeFetchOptions): Promise<CodeFetchResult> {
  const root = `Cartridges/${options.codeVersion}`;
  const top = await listChildren(instance, root);
  const cartridges = top
    .filter((e) => e.isCollection)
    .map((e) => e.name)
    .filter((n) => !options.cartridges?.length || options.cartridges.includes(n));

  // Recursive listing, depth 1 at a time (depth "infinity" is often refused)
  const remote: Array<{path: string; rel: string; size: number; modified: number}> = [];
  const queue = cartridges.map((c) => `${root}/${c}`);
  while (queue.length) {
    const dir = queue.shift()!;
    for (const e of await listChildren(instance, dir)) {
      const name = e.name;
      const full = `${dir}/${name}`;
      if (e.isCollection) {
        if (name !== 'node_modules' && name !== 'static') queue.push(full);
      } else {
        const rel = full.slice(root.length + 1);
        if (isAnalyzed(rel)) remote.push({path: full, rel, size: e.contentLength ?? 0, modified: e.lastModified?.getTime() ?? 0});
      }
    }
  }

  const base = join(hostDir(hostname), 'code', options.codeVersion);
  const files: SourceFile[] = [];
  let fromCache = 0;
  const concurrency = options.concurrency ?? 8;
  let i = 0;
  async function worker(): Promise<void> {
    while (i < remote.length) {
      const r = remote[i++];
      const cachePath = join(base, `${r.rel}.${keyFor(r.size, r.modified)}`);
      let content = await readCached(cachePath);
      if (content !== undefined) fromCache++;
      else {
        content = new TextDecoder().decode(await instance.webdav.get(r.path));
        await writeCached(cachePath, content);
      }
      files.push({path: r.rel, content});
    }
  }
  await Promise.all(Array.from({length: Math.min(concurrency, remote.length)}, worker));
  files.sort((a, b) => a.path.localeCompare(b.path));
  return {codeVersion: options.codeVersion, cartridges, files, fromCache};
}

interface Child {
  name: string;
  isCollection: boolean;
  contentLength?: number;
  lastModified?: Date;
}

/** PROPFIND depth 1 without the entry of the listed directory itself. */
async function listChildren(instance: B2CInstance, dir: string): Promise<Child[]> {
  const entries = await instance.webdav.propfind(dir, '1');
  const self = `/${dir.replace(/^\/+|\/+$/g, '')}`;
  return entries
    .filter((e) => !decodeURIComponent(e.href).replace(/\/+$/, '').endsWith(self))
    .map((e) => ({
      name: decodeURIComponent(e.href.replace(/\/+$/, '').split('/').pop() || e.displayName || ''),
      isCollection: e.isCollection,
      contentLength: e.contentLength,
      lastModified: e.lastModified,
    }))
    .filter((e) => e.name);
}

export interface CodeVersionInfo {
  id?: string;
  active?: boolean;
  last_modification_time?: string;
  activation_time?: string;
  cartridges?: string[];
}

/** Code versions through SCAPI (dx/scripts) or OCAPI, chosen by the SDK's scripts backend. */
export async function listCodeVersions(instance: B2CInstance): Promise<CodeVersionInfo[]> {
  const versions = await createScriptsBackend({instance}).listCodeVersions();
  return versions.map((v) => ({
    id: v.id,
    active: v.active,
    last_modification_time: v.lastModificationTime,
    activation_time: v.activationTime,
    cartridges: v.cartridges,
  }));
}

export async function getActiveCodeVersionId(instance: B2CInstance): Promise<string | undefined> {
  return (await createScriptsBackend({instance}).getActiveCodeVersion())?.id;
}

/** Job executions, newest first: SCAPI job-execution-search, or OCAPI job_execution_search. */
export async function fetchJobExecutions(instance: B2CInstance, opts: {jobId?: string; count?: number} = {}): Promise<{executions: JobExecution[]; backend: Backend}> {
  const scapi = instance.scapiClientConfig;
  const dispatcher = new BackendDispatcher(
    instance.apiBackend,
    () => (scapi ? createScapiJobsClient({shortCode: scapi.shortCode, tenantId: scapi.tenantId}, scapi.auth) : undefined),
    'jobs',
  );
  const wanted = Math.min(opts.count ?? 100, 200);
  const executions: JobExecution[] = [];
  // pages until `wanted` executions: servers may return fewer per page than asked
  for (let start = 0; executions.length < wanted; ) {
    const options = {jobId: opts.jobId, count: wanted - executions.length, start, sortBy: 'start_time', sortOrder: 'desc' as const};
    const page = await dispatcher.run({
      scapi: (client) => scapiSearchJobExecutions(client, {...options, tenantId: scapi!.tenantId}),
      ocapi: async () => mapOcapiSearchResult(await searchJobExecutions(instance, options)),
    });
    executions.push(...page.hits.map((h) => mapCanonicalToOcapiExecution(h) as JobExecution));
    start += page.hits.length;
    if (page.hits.length === 0 || start >= page.total) break;
  }
  return {executions, backend: dispatcher.active ?? 'ocapi'};
}

/** Reads a file under Logs/ or Cartridges/ (tail only for large files). Log text is masked. */
export async function readInstanceFile(instance: B2CInstance, path: string, tailKb = 256): Promise<{path: string; size?: number; truncated: boolean; content: string}> {
  const clean = path.replace(/^\/+/, '');
  if (!/^(Logs|Cartridges)\//.test(clean) || clean.split('/').includes('..')) {
    throw new Error('Only paths under Logs/ or Cartridges/ can be read.');
  }
  const parent = clean.slice(0, clean.lastIndexOf('/'));
  const name = clean.slice(clean.lastIndexOf('/') + 1);
  const entry = (await listChildren(instance, parent)).find((c) => c.name === name);
  if (!entry || entry.isCollection) throw new Error(`File not found: ${clean}`);
  const max = tailKb * 1024;
  const size = entry.contentLength;
  let text: string;
  let truncated = false;
  if (size !== undefined && size > max) {
    truncated = true;
    const res = await instance.webdav.request(clean, {method: 'GET', headers: {Range: `bytes=${size - max}-`}});
    if (!res.ok && res.status !== 206) throw new Error(`WebDAV GET ${clean} failed: ${res.status}`);
    text = await res.text();
  } else {
    text = new TextDecoder().decode(await instance.webdav.get(clean));
  }
  return {path: clean, size, truncated, content: clean.startsWith('Logs/') ? maskPII(text) : text};
}

type SearchPath =
  | '/sites/{site_id}/promotion_search'
  | '/sites/{site_id}/campaign_search'
  | '/sites/{site_id}/promotion_campaign_assignment_search'
  | '/sites/{site_id}/coupon_search'
  | '/sites/{site_id}/customer_group_search';

/** Pages through an OCAPI *_search endpoint with match_all. */
export async function searchAll<T>(instance: B2CInstance, path: SearchPath, siteId: string, pageSize = 200, maxRecords = 20_000): Promise<T[]> {
  const out: T[] = [];
  let start = 0;
  for (;;) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const post = instance.ocapi.POST as any;
    const {data, error} = await post(path, {
      params: {path: {site_id: siteId}},
      body: {query: {match_all_query: {}}, select: '(**)', count: pageSize, start},
    });
    if (error) throw new Error(`OCAPI POST ${path.replace('{site_id}', siteId)} failed: ${JSON.stringify(error)}`);
    const hits = (data?.hits ?? []) as T[];
    out.push(...hits);
    const total = Number(data?.total ?? 0);
    start += hits.length;
    if (hits.length === 0 || start >= total || start >= maxRecords) break;
  }
  return out;
}

export async function fetchPromoBundle(instance: B2CInstance, siteId: string, currencies?: string[]): Promise<{bundle: PromoBundle; backend: Backend}> {
  const scapi = instance.scapiClientConfig;
  const dispatcher = new BackendDispatcher(instance.apiBackend, () => scapi, 'promotions');
  const bundle = await dispatcher.run({
    scapi: (config) => fetchPromoBundleScapi(config, siteId, currencies),
    ocapi: () => fetchPromoBundleOcapi(instance, siteId, currencies),
  });
  return {bundle, backend: dispatcher.active ?? 'ocapi'};
}

export async function fetchPromoBundleOcapi(instance: B2CInstance, siteId: string, currencies?: string[]): Promise<PromoBundle> {
  const [promotions, campaigns, assignments, coupons, customerGroups] = await Promise.all([
    searchAll<Promotion>(instance, '/sites/{site_id}/promotion_search', siteId),
    searchAll<Campaign>(instance, '/sites/{site_id}/campaign_search', siteId),
    searchAll<Assignment>(instance, '/sites/{site_id}/promotion_campaign_assignment_search', siteId),
    searchAll<Coupon>(instance, '/sites/{site_id}/coupon_search', siteId),
    searchAll<CustomerGroup>(instance, '/sites/{site_id}/customer_group_search', siteId),
  ]);
  return {site: siteId, now: new Date().toISOString(), currencies, promotions, campaigns, assignments, coupons, customerGroups};
}

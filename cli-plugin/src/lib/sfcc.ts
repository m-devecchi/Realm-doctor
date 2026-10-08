/**
 * Read-only data access to a B2C Commerce instance through the official SDK.
 * Every function only issues GET / PROPFIND / ranged GET on WebDAV and GET or
 * POST *_search on OCAPI. Nothing is written to the instance.
 */
import type {B2CInstance} from '@salesforce/b2c-tooling-sdk';
import {listLogFiles} from '@salesforce/b2c-tooling-sdk/operations/logs';
import {join} from 'node:path';
import {hostDir, keyFor, readCached, writeCached} from './cache.js';
import {dateFromLogFileName, parseLogText, type ParsedEntry} from './logparse.js';
import {maskPII} from './mask.js';
import {isAnalyzed, type SourceFile} from '../rules/source.js';
import type {Assignment, Campaign, Coupon, CustomerGroup, PromoBundle, Promotion} from '../rules/promo-rules.js';

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

export async function getActiveCodeVersionId(instance: B2CInstance): Promise<string | undefined> {
  const {data, error} = await instance.ocapi.GET('/code_versions', {});
  if (error) throw new Error(`OCAPI GET /code_versions failed: ${JSON.stringify(error)}`);
  return (data?.data ?? []).find((v) => v.active)?.id;
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

export async function fetchPromoBundle(instance: B2CInstance, siteId: string, currencies?: string[]): Promise<PromoBundle> {
  const [promotions, campaigns, assignments, coupons, customerGroups] = await Promise.all([
    searchAll<Promotion>(instance, '/sites/{site_id}/promotion_search', siteId),
    searchAll<Campaign>(instance, '/sites/{site_id}/campaign_search', siteId),
    searchAll<Assignment>(instance, '/sites/{site_id}/promotion_campaign_assignment_search', siteId),
    searchAll<Coupon>(instance, '/sites/{site_id}/coupon_search', siteId),
    searchAll<CustomerGroup>(instance, '/sites/{site_id}/customer_group_search', siteId),
  ]);
  return {site: siteId, now: new Date().toISOString(), currencies, promotions, campaigns, assignments, coupons, customerGroups};
}

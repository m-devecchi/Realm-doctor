/**
 * Minimal fake B2C Commerce instance for end-to-end tests:
 * Account Manager token endpoint, WebDAV (PROPFIND/GET with Range) and the
 * OCAPI Data endpoints used by realm-doctor. Every request is recorded so tests
 * can assert that the audit commands never write to the instance.
 */
import {execFileSync} from 'node:child_process';
import {readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync} from 'node:fs';
import {createServer, type Server} from 'node:https';
import type {AddressInfo} from 'node:net';
import {tmpdir} from 'node:os';
import {join, relative, sep} from 'node:path';

export interface RecordedRequest {
  method: string;
  path: string;
  auth?: string;
  range?: string;
}

export interface MockSfcc {
  host: string;
  caFile: string;
  requests: RecordedRequest[];
  close(): Promise<void>;
}

const DAV = '/on/demandware.servlet/webdav/Sites';

function fakeJwt(): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({alg: 'none', typ: 'JWT'})}.${b64({sub: 'test-client', exp: Math.floor(Date.now() / 1000) + 3600, scope: 'mail'})}.sig`;
}

function propResponse(href: string, isCollection: boolean, size: number, modified: Date): string {
  return `<D:response><D:href>${href}</D:href><D:propstat><D:prop>
<D:displayname>${href.replace(/\/$/, '').split('/').pop()}</D:displayname>
<D:resourcetype>${isCollection ? '<D:collection/>' : ''}</D:resourcetype>
${isCollection ? '' : `<D:getcontentlength>${size}</D:getcontentlength>`}
<D:getlastmodified>${modified.toUTCString()}</D:getlastmodified>
</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`;
}

export interface MockOptions {
  /** folder whose files are served as /Logs */
  logsDir: string;
  /** folder served as /Cartridges/<codeVersion> */
  cartridgesDir: string;
  codeVersion: string;
  /** promo bundle served by the OCAPI *_search endpoints for this site */
  promoBundle: {site: string; promotions: unknown[]; campaigns: unknown[]; assignments: unknown[]; coupons: unknown[]; customerGroups: unknown[]};
  /** page size forced by the server, to exercise paging */
  maxPage?: number;
}

export async function startMockSfcc(opts: MockOptions): Promise<MockSfcc> {
  const dir = mkdtempSync(join(tmpdir(), 'mock-sfcc-'));
  const key = join(dir, 'key.pem');
  const cert = join(dir, 'cert.pem');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1',
    '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
  ], {stdio: 'ignore'});

  const requests: RecordedRequest[] = [];
  const searchData: Record<string, unknown[]> = {
    promotion_search: opts.promoBundle.promotions,
    campaign_search: opts.promoBundle.campaigns,
    promotion_campaign_assignment_search: opts.promoBundle.assignments,
    coupon_search: opts.promoBundle.coupons,
    customer_group_search: opts.promoBundle.customerGroups,
  };

  const server: Server = createServer({key: readFileSync(key), cert: readFileSync(cert)}, (req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'https://localhost');
      const path = decodeURIComponent(url.pathname);
      requests.push({method: req.method ?? '', path, auth: req.headers.authorization?.split(' ')[0], range: req.headers.range});
      const send = (status: number, payload: string | Buffer, type = 'application/json', headers: Record<string, string> = {}) => {
        res.writeHead(status, {'Content-Type': type, ...headers});
        res.end(payload);
      };

      // Account Manager
      if (path === '/dwsso/oauth2/access_token' && req.method === 'POST') {
        if (!/grant_type=client_credentials/.test(body)) return send(400, '{"error":"unsupported_grant_type"}');
        return send(200, JSON.stringify({access_token: fakeJwt(), expires_in: 1800, token_type: 'Bearer'}));
      }

      if (!req.headers.authorization?.startsWith('Bearer ')) return send(401, '{"error":"unauthorized"}');

      // WebDAV
      if (path.startsWith(DAV)) {
        const rel = path.slice(DAV.length).replace(/^\/+/, '').replace(/\/+$/, '');
        const local = rel === 'Logs' || rel.startsWith('Logs/')
          ? join(opts.logsDir, rel.slice('Logs'.length))
          : rel.startsWith(`Cartridges/${opts.codeVersion}`)
            ? join(opts.cartridgesDir, rel.slice(`Cartridges/${opts.codeVersion}`.length))
            : undefined;
        let st;
        try {
          st = local ? statSync(local) : undefined;
        } catch {
          st = undefined;
        }
        if (!local || !st) return send(404, 'not found', 'text/plain');

        if (req.method === 'PROPFIND') {
          const self = `${DAV}/${rel}${st.isDirectory() ? '/' : ''}`;
          const parts = [propResponse(self, st.isDirectory(), st.size, st.mtime)];
          if (st.isDirectory() && req.headers.depth !== '0') {
            for (const name of readdirSync(local)) {
              const cst = statSync(join(local, name));
              const href = `${DAV}/${rel}/${encodeURIComponent(name)}${cst.isDirectory() ? '/' : ''}`;
              // log files: last-modified from the date in the name
              const m = /(\d{4})(\d{2})(\d{2})\.log$/.exec(name);
              const modified = m ? new Date(`${m[1]}-${m[2]}-${m[3]}T23:00:00Z`) : cst.mtime;
              parts.push(propResponse(href, cst.isDirectory(), cst.size, modified));
            }
          }
          return send(207, `<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">${parts.join('')}</D:multistatus>`, 'application/xml');
        }
        if (req.method === 'GET' && st.isFile()) {
          const content = readFileSync(local);
          const range = /^bytes=(\d+)-$/.exec(req.headers.range ?? '');
          if (range) return send(206, content.subarray(Number(range[1])), 'text/plain', {'Content-Range': `bytes ${range[1]}-${content.length - 1}/${content.length}`});
          return send(200, content, 'text/plain');
        }
        return send(405, 'method not allowed in mock', 'text/plain');
      }

      // OCAPI Data
      const ocapi = /^\/s\/-\/dw\/data\/v\d+_\d+(\/.*)$/.exec(path);
      if (ocapi) {
        const p = ocapi[1];
        if (p === '/code_versions' && req.method === 'GET') {
          return send(200, JSON.stringify({count: 2, data: [{id: 'old_version', active: false}, {id: opts.codeVersion, active: true}], total: 2}));
        }
        const search = /^\/sites\/([^/]+)\/(\w+_search)$/.exec(p);
        if (search && req.method === 'POST') {
          if (search[1] !== opts.promoBundle.site) return send(404, '{"fault":{"type":"SiteNotFoundException"}}');
          const all = searchData[search[2]];
          if (!all) return send(404, '{"fault":{"type":"ResourcePathNotFoundException"}}');
          const q = JSON.parse(body || '{}') as {start?: number; count?: number};
          const start = q.start ?? 0;
          const count = Math.min(q.count ?? 25, opts.maxPage ?? 200);
          const hits = all.slice(start, start + count);
          return send(200, JSON.stringify({count: hits.length, hits, start, total: all.length}));
        }
      }
      return send(404, '{"fault":{"type":"NotFound"}}');
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const caFile = join(dir, 'ca.pem');
  writeFileSync(caFile, readFileSync(cert));
  return {
    host: `localhost:${port}`,
    caFile,
    requests,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

export function relPosix(root: string, p: string): string {
  return relative(root, p).split(sep).join('/');
}

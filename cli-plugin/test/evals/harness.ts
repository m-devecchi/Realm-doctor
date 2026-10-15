/**
 * Shared set-up of the skill evals: the real MCP server over stdio, a multi-instance dw.json and the fake
 * HTTPS instance. A skill is evaluated by replaying the tool calls it prescribes against the fake instance.
 */
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {PromoBundle} from '../../src/rules/promo-rules.js';
import {startMockSfcc, type MockSfcc} from '../e2e/mock-sfcc.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REPO = join(ROOT, '..');
export const FIX = join(ROOT, 'test', 'fixtures');
export const bundle = JSON.parse(readFileSync(join(FIX, 'promo', 'bundle.json'), 'utf8')) as PromoBundle;

const allow = [
  {method: 'POST', path: '/s/-/dw/data/*/sites/*/*_search', action: 'allow'},
  {method: 'POST', path: '/s/-/dw/data/*/job_execution_search', action: 'allow'},
];

export interface Harness {
  sfcc: MockSfcc;
  client: Client;
  call(name: string, args?: Record<string, unknown>): Promise<{isError?: boolean; text: string; json?: any}>;
  close(): Promise<void>;
}

export async function startHarness(options: {logsDir?: string; cartridgesDir?: string} = {}): Promise<Harness> {
  if (!existsSync(join(ROOT, 'dist', 'commands', 'mcp.js'))) throw new Error('Run `npm run build` first.');
  const work = mkdtempSync(join(tmpdir(), 'realm-doctor-eval-'));
  mkdirSync(join(work, 'home'));
  const sfcc = await startMockSfcc({
    logsDir: options.logsDir ?? join(FIX, 'logs'),
    cartridgesDir: options.cartridgesDir ?? join(FIX, 'cartridges'),
    codeVersion: 'v1',
    promoBundle: bundle,
    jobs: JSON.parse(readFileSync(join(FIX, 'jobs', 'executions.json'), 'utf8')),
    maxPage: 5,
  });
  const base = {hostname: sfcc.host, 'account-manager-host': sfcc.host, 'client-id': 'test-client'};
  writeFileSync(
    join(work, 'dw.json'),
    JSON.stringify({configs: [{name: 'mock-sbx', active: true, ...base, 'client-secret': 'test-secret', safety: {level: 'READ_ONLY', rules: allow}}]}),
  );
  const client = new Client({name: 'realm-doctor-eval', version: '0.0.0'});
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [join(ROOT, 'bin', 'run.js'), 'mcp', '--config', join(work, 'dw.json')],
      cwd: tmpdir(),
      stderr: 'pipe',
      env: {
        ...(process.env as Record<string, string>),
        HOME: join(work, 'home'),
        NODE_EXTRA_CA_CERTS: sfcc.caFile,
        NO_PROXY: 'localhost,127.0.0.1',
        no_proxy: 'localhost,127.0.0.1',
        REALM_DOCTOR_CACHE: join(work, 'cache'),
        // the fixture logs are from 2026-10-08: a "short window" is only short against this clock
        REALM_DOCTOR_NOW: '2026-10-08T12:00:00Z',
        SFCC_CLIENT_SECRET: 'test-secret',
        SFCC_SAFETY_CONFIG: '',
      },
    }),
  );
  return {
    sfcc,
    client,
    async call(name, args = {}) {
      const res = (await client.callTool({name, arguments: args})) as {isError?: boolean; content: Array<{type: string; text: string}>};
      const text = res.content.map((c) => c.text).join('');
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
      return {isError: res.isError, text, json};
    },
    async close() {
      await client.close();
      await sfcc.close();
    },
  };
}

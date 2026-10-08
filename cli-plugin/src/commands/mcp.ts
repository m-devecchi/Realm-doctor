import {Command, Flags} from '@oclif/core';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
import {auditCode, auditErrors, auditFrontend, auditHyperforce, auditJobs, auditPromotions, auditQuota} from '../lib/audits.js';
import {VERSION} from '../lib/distribution.js';
import {listInstances, loadDotEnv, locateConfig, resolveTarget, type ConfigLocation} from '../lib/instances.js';
import {listCodeVersions, readInstanceFile} from '../lib/sfcc.js';
import {allRules} from '../rules/index.js';


const instanceName = z
  .string()
  .optional()
  .describe('Instance name from dw.json (see list_instances). Omit only when the user means the default instance. Never guess between production and sandbox.');

type ToolResult = {content: Array<{type: 'text'; text: string}>; isError?: boolean};

const ok = (value: unknown): ToolResult => ({content: [{type: 'text', text: JSON.stringify(value)}]});
const fail = (error: unknown): ToolResult => ({content: [{type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}`}], isError: true});

export function createServer(loc: ConfigLocation): McpServer {
  const server = new McpServer(
    {name: 'realm-doctor', version: VERSION},
    {
      instructions:
        'Read-only audits of Salesforce B2C Commerce instances. Every tool takes instanceName (from list_instances). ' +
        'Reports are JSON: findings with rule, severity, evidence, impact and fix. Personal data in logs is masked. ' +
        'Nothing is ever written to an instance.',
    },
  );
  const readOnly = {readOnlyHint: true, destructiveHint: false, openWorldHint: true};

  /** resolves the instance and runs the audit under its Safety Mode */
  const withTarget =
    <A extends {instanceName?: string}>(fn: (t: Awaited<ReturnType<typeof resolveTarget>>, args: A) => Promise<unknown>) =>
    async (args: A): Promise<ToolResult> => {
      try {
        const t = await resolveTarget(loc, args.instanceName);
        const result = await t.run(() => fn(t, args));
        return ok(addInstance(result, t.instanceName));
      } catch (error) {
        return fail(error);
      }
    };

  server.registerTool(
    'list_instances',
    {
      title: 'List instances',
      description: 'Lists the instances configured in dw.json (name, hostname, default, Safety Mode). Never returns secrets.',
      inputSchema: {},
      annotations: {...readOnly, openWorldHint: false},
    },
    async () => {
      try {
        return ok(listInstances(loc));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'list_rules',
    {title: 'List rules', description: 'Lists every rule id used in the reports, with severity and title.', inputSchema: {}, annotations: {...readOnly, openWorldHint: false}},
    async () => ok({rules: allRules()}),
  );

  server.registerTool(
    'audit_errors',
    {
      title: 'Audit error logs',
      description: 'Reads error logs (WebDAV, read-only), groups entries by signature and reports new errors, spikes and top recurring errors.',
      inputSchema: {
        instanceName,
        since: z.string().optional().describe('Period start: 24h, 7d or ISO date-time (default 24h)'),
        prefixes: z.array(z.string()).optional().describe('Log prefixes (default error, customerror, fatal)'),
        day: z.string().optional().describe('Day evaluated for new errors and spikes, YYYY-MM-DD (default: last day in the data)'),
        top: z.number().int().positive().optional().describe('Signatures returned in data (default 30)'),
      },
      annotations: readOnly,
    },
    withTarget((t, a: {instanceName?: string; since?: string; prefixes?: string[]; day?: string; top?: number}) => auditErrors(t, a)),
  );

  server.registerTool(
    'audit_quota',
    {
      title: 'Audit quota',
      description: 'Reads quota logs (read-only) and reports enforced and non-enforced limits exceeded and warning thresholds.',
      inputSchema: {instanceName, since: z.string().optional().describe('Period start (default 7d)')},
      annotations: readOnly,
    },
    withTarget((t, a: {instanceName?: string; since?: string}) => auditQuota(t, a)),
  );

  server.registerTool(
    'audit_jobs',
    {
      title: 'Audit jobs',
      description: 'Reads recent job executions (read-only) and reports failing, slow, stuck and overlapping jobs.',
      inputSchema: {
        instanceName,
        jobId: z.string().optional().describe('Only this job'),
        count: z.number().int().positive().max(200).optional().describe('Most recent executions to read (default 100)'),
      },
      annotations: readOnly,
    },
    withTarget((t, a: {instanceName?: string; jobId?: string; count?: number}) => auditJobs(t, a)),
  );

  const codeInput = {
    instanceName,
    codeVersion: z.string().optional().describe('Code version (default: the active one)'),
    cartridges: z.array(z.string()).optional().describe('Only these cartridges'),
    dir: z.string().optional().describe('Analyze this local folder instead of an instance'),
  };
  type CodeArgs = {instanceName?: string; codeVersion?: string; cartridges?: string[]; dir?: string; maxFindings?: number};
  const codeTool = (fn: (target: (() => Awaited<ReturnType<typeof resolveTarget>>) | undefined, a: CodeArgs) => Promise<unknown>) => async (a: CodeArgs) => {
    if (a.dir) {
      try {
        return ok(await fn(undefined, a));
      } catch (error) {
        return fail(error);
      }
    }
    return withTarget<CodeArgs>((t, args) => fn(() => t, args))(a);
  };

  server.registerTool(
    'audit_code',
    {
      title: 'Audit cartridge code',
      description: 'Static analysis of the deployed cartridges (JS and ISML), read via WebDAV, or of a local folder.',
      inputSchema: {...codeInput, maxFindings: z.number().int().positive().optional().describe('Maximum findings returned (default 200)')},
      annotations: readOnly,
    },
    codeTool((target, a) => auditCode(target, {...a, maxFindings: a.maxFindings ?? 200})),
  );

  server.registerTool(
    'audit_hyperforce',
    {
      title: 'Hyperforce readiness',
      description: 'Looks for hardcoded IPs and instance hostnames in the deployed code and returns the Hyperforce checklist.',
      inputSchema: codeInput,
      annotations: readOnly,
    },
    codeTool((target, a) => auditHyperforce(target, a)),
  );

  server.registerTool(
    'audit_promotions',
    {
      title: 'Audit promotions',
      description: 'Reads promotions, campaigns, assignments, coupons and customer groups of a site (OCAPI search, read-only) and reports misconfigurations.',
      inputSchema: {
        instanceName,
        site: z.string().describe('Site id'),
        currencies: z.array(z.string()).optional().describe('Site currencies, e.g. ["EUR"]'),
      },
      annotations: readOnly,
    },
    withTarget(async (t, a: {instanceName?: string; site: string; currencies?: string[]}) => (await auditPromotions(() => t, a)).report),
  );

  server.registerTool(
    'audit_frontend',
    {
      title: 'Audit frontend',
      description: 'Runs PageSpeed Insights on public storefront URLs and reports Core Web Vitals, weight, third parties and console errors.',
      inputSchema: {urls: z.array(z.string().url()).min(1), strategy: z.enum(['mobile', 'desktop']).optional()},
      annotations: readOnly,
    },
    async (a: {urls: string[]; strategy?: 'mobile' | 'desktop'}) => {
      try {
        return ok(await auditFrontend(a));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'list_code_versions',
    {title: 'List code versions', description: 'Lists code versions with the active one and activation dates (read-only).', inputSchema: {instanceName}, annotations: readOnly},
    withTarget(async (t) => ({codeVersions: await listCodeVersions(t.instance)})),
  );

  server.registerTool(
    'read_instance_file',
    {
      title: 'Read log or code file',
      description: 'Reads one file under Logs/ or Cartridges/ (the tail only for large files). Log text is masked. Use it for job logs and to inspect code from findings.',
      inputSchema: {
        instanceName,
        path: z.string().describe('e.g. Logs/jobs/ExportOrders/Job-ExportOrders-0123.log or Cartridges/v1/app_custom/cartridge/scripts/x.js'),
        tailKb: z.number().int().positive().max(2048).optional().describe('Read at most this many KB from the end (default 256)'),
      },
      annotations: readOnly,
    },
    withTarget((t, a: {instanceName?: string; path: string; tailKb?: number}) => readInstanceFile(t.instance, a.path, a.tailKb)),
  );

  return server;
}

function addInstance(result: unknown, name?: string): unknown {
  if (result && typeof result === 'object' && 'target' in result) {
    const r = result as {target: Record<string, unknown>};
    return {...r, target: {instance: name, ...r.target}};
  }
  return name ? {instance: name, ...(result as object)} : result;
}

export default class Mcp extends Command {
  static description =
    'Starts the realm-doctor MCP server on stdio. Read-only audit tools for every instance in dw.json; each call takes instanceName and runs under that instance\'s Safety Mode.';
  static examples = ['<%= config.bin %> mcp --config ./dw.json'];
  static flags = {
    config: Flags.string({description: 'Path to dw.json (env SFCC_CONFIG; default: <project-directory>/dw.json)'}),
    'project-directory': Flags.string({description: 'Folder with dw.json and .env (env SFCC_PROJECT_DIRECTORY; default: current folder)'}),
  };

  async run(): Promise<void> {
    const {flags} = await this.parse(Mcp);
    process.env.SFCC_DISABLE_TELEMETRY ??= 'true';
    const loc = locateConfig({config: flags.config, projectDirectory: flags['project-directory']});
    loadDotEnv(loc);
    const server = createServer(loc);
    await server.connect(new StdioServerTransport());
    process.stderr.write(`realm-doctor MCP ${VERSION} ready (config: ${loc.configPath ?? loc.projectDirectory})\n`);
    // keep running until the client closes stdin
    await new Promise<void>((resolveDone) => {
      process.stdin.on('close', resolveDone);
      process.stdin.on('end', resolveDone);
    });
  }
}

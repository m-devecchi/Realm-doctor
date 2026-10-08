import {Command, Flags, ux} from '@oclif/core';
import {copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join, resolve} from 'node:path';
import {mcpServers, PACKAGE_ROOT, VERSION} from '../../lib/distribution.js';

const MARKER = 'realm-doctor';

/**
 * Installs the skills and the two MCP servers for GitHub Copilot (CLI and app), in the user's Copilot folder.
 * Nothing else is installed: the MCP servers run through npx.
 */
export default class InstallCopilot extends Command {
  static description =
    'Installs the realm-doctor skills and MCP servers for GitHub Copilot: skills in ~/.copilot/skills, MCP servers in ~/.copilot/mcp-config.json. Existing entries are kept; run again to update, --remove to uninstall.';
  static examples = [
    'npx github:m-devecchi/Realm-doctor install copilot --config ~/sfcc/dw.json',
    'npx github:m-devecchi/Realm-doctor install copilot --remove',
  ];
  static flags = {
    config: Flags.string({description: 'Path to the dw.json with your instances (required unless --remove)'}),
    remove: Flags.boolean({description: 'Remove the realm-doctor skills and MCP servers', default: false}),
    'copilot-home': Flags.string({description: 'Copilot folder (env COPILOT_HOME; default ~/.copilot)'}),
  };

  async run(): Promise<void> {
    const {flags} = await this.parse(InstallCopilot);
    const home = resolve(flags['copilot-home'] ?? process.env.COPILOT_HOME ?? join(homedir(), '.copilot'));
    const skillsSrc = join(PACKAGE_ROOT, '.claude', 'skills');
    const names = readdirSync(skillsSrc, {withFileTypes: true}).filter((d) => d.isDirectory()).map((d) => d.name);
    const skillsDst = join(home, 'skills');
    const refDst = join(home, MARKER, 'reference');
    const mcpFile = join(home, 'mcp-config.json');
    const config = readMcpConfig(mcpFile);

    if (flags.remove) {
      for (const n of names) rmSync(join(skillsDst, n), {recursive: true, force: true});
      rmSync(join(home, MARKER), {recursive: true, force: true});
      for (const k of Object.keys(mcpServers(''))) delete config.mcpServers[k];
      writeMcpConfig(mcpFile, config);
      ux.stdout(`Removed ${names.length} realm-doctor skills and the MCP servers from ${home}.`);
      return;
    }

    if (!flags.config) this.error('Pass --config <path to dw.json> (the file with your instances).');
    const dwJson = resolve(flags.config);
    if (!existsSync(dwJson)) this.error(`No file at ${dwJson}. Create it from config/dw.example.json in the repository.`);

    // reference files used by the skills, then the skills with the reference path made absolute
    mkdirSync(refDst, {recursive: true});
    cpSync(join(PACKAGE_ROOT, '.claude', 'reference'), refDst, {recursive: true});
    for (const n of names) {
      const dst = join(skillsDst, n);
      rmSync(dst, {recursive: true, force: true});
      cpSync(join(skillsSrc, n), dst, {recursive: true});
      const md = join(dst, 'SKILL.md');
      writeFileSync(md, readFileSync(md, 'utf8').replaceAll('../../reference/', `${refDst.replaceAll('\\', '/')}/`));
    }
    writeFileSync(join(home, MARKER, 'version'), `${VERSION}\n`);

    for (const [name, server] of Object.entries(mcpServers(dwJson))) {
      config.mcpServers[name] = {type: 'local', ...server, tools: ['*']};
    }
    writeMcpConfig(mcpFile, config);

    ux.stdout(`realm-doctor ${VERSION} installed for GitHub Copilot.

  Skills:       ${names.length} in ${skillsDst}
  MCP servers:  realm-doctor, b2c-dx-mcp in ${mcpFile}
  Instances:    ${dwJson}

Restart Copilot, then ask e.g. "check the kit" or "weekly review of <instance>".
The first start of each MCP server downloads it (about a minute).`);
  }
}

interface McpConfig {
  mcpServers: Record<string, unknown>;
  [k: string]: unknown;
}

function readMcpConfig(file: string): McpConfig {
  if (!existsSync(file)) return {mcpServers: {}};
  const json = JSON.parse(readFileSync(file, 'utf8')) as McpConfig;
  json.mcpServers ??= {};
  return json;
}

function writeMcpConfig(file: string, config: McpConfig): void {
  mkdirSync(join(file, '..'), {recursive: true});
  if (existsSync(file)) copyFileSync(file, `${file}.bak`);
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, {mode: 0o600});
}

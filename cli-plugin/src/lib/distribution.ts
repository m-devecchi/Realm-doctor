import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

/** <package>/cli-plugin */
export const CLI_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** package root: the repository clone, or the package installed by npx */
export const PACKAGE_ROOT = join(CLI_ROOT, '..');
export const VERSION = (JSON.parse(readFileSync(join(CLI_ROOT, 'package.json'), 'utf8')) as {version: string}).version;

export const REPO_SPEC = 'github:m-devecchi/Realm-doctor';
export const OFFICIAL_MCP = '@salesforce/b2c-dx-mcp@3.5.0';

/** MCP server entries for a client config, from the default branch (main); same spec as the README commands, so `init` already fills the npx cache. */
export function mcpServers(dwJson: string): Record<string, {command: string; args: string[]; env: Record<string, string>}> {
  return {
    'realm-doctor': {
      command: 'npx',
      args: ['-y', REPO_SPEC, 'mcp'],
      env: {SFCC_CONFIG: dwJson, SFCC_DISABLE_TELEMETRY: 'true'},
    },
    'b2c-dx-mcp': {
      command: 'npx',
      args: ['-y', OFFICIAL_MCP, '--config', dwJson],
      env: {SFCC_DISABLE_TELEMETRY: 'true'},
    },
  };
}

/** resolve() that also expands a leading ~ (PowerShell and some clients pass it literally) */
export function resolveUserPath(p: string): string {
  return resolve(p.replace(/^~(?=$|[\\/])/, homedir()));
}

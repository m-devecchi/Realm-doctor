/**
 * Instance resolution for the MCP server: one dw.json with every realm, an
 * instance picked per call, and the instance's Safety Mode applied to every
 * request of that call (same mechanism as the official b2c-dx-mcp server).
 */
import {existsSync, readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {getB2CConfigDirectory, resolveConfig} from '@salesforce/b2c-tooling-sdk/config';
import {createSafetyMiddleware, globalMiddlewareRegistry} from '@salesforce/b2c-tooling-sdk/clients';
import {loadGlobalSafetyConfig, resolveEffectiveSafetyConfig, SafetyGuard} from '@salesforce/b2c-tooling-sdk/safety';
import type {Target} from './audits.js';

export interface ConfigLocation {
  /** explicit dw.json path (--config / SFCC_CONFIG) */
  configPath?: string;
  /** folder holding dw.json and .env (--project-directory / SFCC_PROJECT_DIRECTORY, default: cwd) */
  projectDirectory: string;
}

export function locateConfig(opts: {config?: string; projectDirectory?: string}, env: NodeJS.ProcessEnv = process.env): ConfigLocation {
  const configPath = opts.config || env.SFCC_CONFIG || undefined;
  const projectDirectory = resolve(opts.projectDirectory || env.SFCC_PROJECT_DIRECTORY || process.cwd());
  return {configPath: configPath ? resolve(configPath) : undefined, projectDirectory};
}

export function dwJsonPath(loc: ConfigLocation): string {
  return loc.configPath ?? join(loc.projectDirectory, 'dw.json');
}

/** Loads SFCC_* variables from <projectDirectory>/.env without overriding the environment. */
export function loadDotEnv(loc: ConfigLocation, env: NodeJS.ProcessEnv = process.env): void {
  const file = join(loc.projectDirectory, '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(SFCC_[A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

export interface InstanceInfo {
  name: string;
  hostname?: string;
  active: boolean;
  safety: string;
  hasSecret: boolean;
}

/** Instance names from dw.json. Never returns secrets. */
export function listInstances(loc: ConfigLocation): {file: string; instances: InstanceInfo[]} {
  const file = dwJsonPath(loc);
  if (!existsSync(file)) throw new Error(`No dw.json at ${file}. Set the dw.json path in the plugin settings (or --config / SFCC_CONFIG).`);
  const json = JSON.parse(readFileSync(file, 'utf8')) as {configs?: Array<Record<string, unknown>>} & Record<string, unknown>;
  const configs = json.configs ?? [json];
  return {
    file,
    instances: configs.map((c) => ({
      name: String(c.name ?? '(unnamed)'),
      hostname: c.hostname as string | undefined,
      active: c.active === true,
      safety: String((c.safety as {level?: string} | undefined)?.level ?? 'NONE'),
      hasSecret: Boolean(c['client-secret'] ?? c.clientSecret ?? process.env.SFCC_CLIENT_SECRET),
    })),
  };
}

export interface ResolvedTarget extends Target {
  instanceName?: string;
  /** runs the callback with the instance's Safety Mode applied to every HTTP request */
  run<T>(cb: () => Promise<T>): Promise<T>;
}

export async function resolveTarget(loc: ConfigLocation, instanceName?: string, env: NodeJS.ProcessEnv = process.env): Promise<ResolvedTarget> {
  const options = {instance: instanceName || undefined, configPath: loc.configPath, projectDirectory: loc.projectDirectory};
  let config = await resolveConfig({}, options);
  if (instanceName && config.values.instanceName !== instanceName) {
    throw new Error(`Instance "${instanceName}" not found in ${dwJsonPath(loc)}. Use list_instances.`);
  }
  if (!config.values.clientSecret && env.SFCC_CLIENT_SECRET) {
    config = await resolveConfig({clientSecret: env.SFCC_CLIENT_SECRET}, options);
  }
  if (!config.values.hostname) throw new Error(`No hostname for instance "${instanceName ?? '(default)'}" in ${dwJsonPath(loc)}.`);
  if (!config.hasB2CInstanceConfig()) throw new Error('Incomplete instance configuration: client-id and client-secret are required.');
  const instance = config.createB2CInstance();
  const safetyEnv = {
    SFCC_SAFETY_LEVEL: env.SFCC_SAFETY_LEVEL,
    SFCC_SAFETY_CONFIRM: env.SFCC_SAFETY_CONFIRM,
    SFCC_SAFETY_CONFIG: env.SFCC_SAFETY_CONFIG,
  };
  const guard = new SafetyGuard(
    resolveEffectiveSafetyConfig(config.values.safety, loadGlobalSafetyConfig(getB2CConfigDirectory(), safetyEnv, loc.projectDirectory), safetyEnv),
  );
  return {
    instance,
    hostname: config.values.hostname,
    instanceName: config.values.instanceName,
    run: (cb) => globalMiddlewareRegistry.runWithOverrides([{name: 'cli-safety-guard', getMiddleware: () => createSafetyMiddleware(guard)}], cb),
  };
}

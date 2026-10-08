/**
 * `realm-doctor install copilot` on a temporary Copilot folder: skills, reference files,
 * MCP config merge, update and removal.
 */
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {FIXTURES} from './helpers.js';

const REPO = join(FIXTURES, '..', '..', '..');
const BIN = join(REPO, 'cli-plugin', 'bin', 'run.js');
const version = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version;

const run = (args: string[], home: string) =>
  spawnSync(process.execPath, [BIN, 'install', 'copilot', ...args], {encoding: 'utf8', env: {...process.env, HOME: home, COPILOT_HOME: join(home, '.copilot')}});

describe('install copilot', () => {
  it('installs skills and MCP servers, keeps other servers, updates and removes cleanly', () => {
    const home = mkdtempSync(join(tmpdir(), 'rd-copilot-'));
    const copilot = join(home, '.copilot');
    mkdirSync(copilot);
    writeFileSync(join(copilot, 'mcp-config.json'), JSON.stringify({mcpServers: {other: {type: 'local', command: 'x', args: [], tools: ['*']}}}));
    const dw = join(home, 'dw.json');
    writeFileSync(dw, '{"configs":[]}');

    const res = run(['--config', dw], home);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toContain('installed for GitHub Copilot');

    const skills = readdirSync(join(copilot, 'skills')).sort();
    expect(skills).toEqual(readdirSync(join(REPO, '.claude', 'skills')).sort());
    const md = readFileSync(join(copilot, 'skills', 'job-health', 'SKILL.md'), 'utf8');
    expect(md).not.toContain('../../reference/');
    const refPath = /`([^`]+conventions\.md)`/.exec(md)![1];
    expect(existsSync(refPath)).toBe(true);

    const cfg = JSON.parse(readFileSync(join(copilot, 'mcp-config.json'), 'utf8'));
    expect(Object.keys(cfg.mcpServers).sort()).toEqual(['b2c-dx-mcp', 'other', 'realm-doctor']);
    expect(cfg.mcpServers['realm-doctor']).toEqual({
      type: 'local',
      command: 'npx',
      args: ['-y', `github:m-devecchi/Realm-doctor#v${version}`, 'mcp'],
      env: {SFCC_CONFIG: dw, SFCC_DISABLE_TELEMETRY: 'true'},
      tools: ['*'],
    });
    expect(cfg.mcpServers['b2c-dx-mcp'].args).toEqual(['-y', '@salesforce/b2c-dx-mcp@3.5.0', '--config', dw]);
    expect(existsSync(join(copilot, 'mcp-config.json.bak'))).toBe(true);

    // running again updates in place
    expect(run(['--config', dw], home).status).toBe(0);
    expect(readdirSync(join(copilot, 'skills'))).toHaveLength(skills.length);

    const removed = run(['--remove'], home);
    expect(removed.status, removed.stderr).toBe(0);
    expect(readdirSync(join(copilot, 'skills'))).toEqual([]);
    expect(Object.keys(JSON.parse(readFileSync(join(copilot, 'mcp-config.json'), 'utf8')).mcpServers)).toEqual(['other']);
    expect(existsSync(join(copilot, 'realm-doctor'))).toBe(false);
  });

  it('refuses a missing dw.json', () => {
    const home = mkdtempSync(join(tmpdir(), 'rd-copilot-'));
    const res = run(['--config', join(home, 'nope.json')], home);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/No file at/);
    expect(existsSync(join(home, '.copilot', 'mcp-config.json'))).toBe(false);
  });
});

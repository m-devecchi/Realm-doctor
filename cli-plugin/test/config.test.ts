import {readFileSync, readdirSync, existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {cacheRoot} from '../src/lib/cache.js';
import {FIXTURES} from './helpers.js';

const require = createRequire(import.meta.url);
const REPO = join(FIXTURES, '..', '..', '..');
const read = (p: string) => JSON.parse(readFileSync(join(REPO, p), 'utf8'));
const SKILLS = join(REPO, '.claude', 'skills');

describe('example configuration', () => {
  const configs = read('config/dw.example.json').configs as Array<{
    name: string;
    hostname: string;
    active?: boolean;
    safety: {level: string; rules: Array<{path: string}>};
  }>;

  it('config/dw.example.json is valid against the official dw.json schema', async () => {
    const {Validator} = await import('jsonschema');
    const schema = require('@salesforce/b2c-tooling-sdk/schemas/dw.schema.json');
    const result = new Validator().validate(read('config/dw.example.json'), schema);
    expect(result.errors.map((e) => e.stack)).toEqual([]);
  });

  it('holds several realms in one file with unique <realm>-<env> names', () => {
    const names = configs.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(names.map((n) => n.split('-')[0])).size).toBeGreaterThan(1);
    for (const n of names) expect(n).toMatch(/^[a-z0-9]+-(sbx|dev|stg|prd)$/);
  });

  it('the default instance (no -i) is a sandbox, never production', () => {
    const active = configs.filter((c) => c.active);
    expect(active).toHaveLength(1);
    expect(active[0].name).toMatch(/-sbx$/);
  });

  it('every instance is READ_ONLY and allows the search POSTs used by the audits', () => {
    const global = read('config/safety.example.json');
    for (const policy of [...configs.map((c) => c.safety), global]) {
      expect(policy.level).toBe('READ_ONLY');
      const paths = policy.rules.map((r: {path: string}) => r.path);
      expect(paths).toContain('/s/-/dw/data/*/sites/*/*_search');
      expect(paths).toContain('/s/-/dw/data/*/job_execution_search');
    }
  });

  it('contains no secrets', () => {
    expect(readFileSync(join(REPO, 'config', 'dw.example.json'), 'utf8')).not.toMatch(/client-secret|password/);
  });
});

describe('project-level setup (no global installs)', () => {
  it('Salesforce tools are local dependencies of the repository', () => {
    const pkg = read('package.json');
    expect(Object.keys(pkg.dependencies)).toEqual(expect.arrayContaining(['@salesforce/b2c-cli', '@salesforce/b2c-dx-mcp']));
    expect(pkg.workspaces).toEqual(['cli-plugin']);
    expect(pkg.scripts.postinstall).toBe('node scripts/postinstall.mjs');
    expect(read('cli-plugin/package.json').bin).toEqual({'realm-doctor': 'bin/run.js'});
  });

  it('MCP configs start the local b2c-dx-mcp from node_modules (no npx download)', () => {
    const claude = read('.mcp.json').mcpServers['b2c-dx-mcp'];
    const vscode = read('.vscode/mcp.json').servers['b2c-dx-mcp'];
    for (const s of [claude, vscode]) {
      expect(s.command).toBe('npx');
      expect(s.args).toEqual(['--no-install', 'b2c-dx-mcp']);
      expect(s.env).toEqual({SFCC_DISABLE_TELEMETRY: 'true'});
    }
    expect(readFileSync(join(REPO, 'config', 'env.example'), 'utf8')).toMatch(/^SFCC_DISABLE_TELEMETRY=true$/m);
  });

  it('the cache lives inside the repository and is git-ignored', () => {
    const saved = process.env.REALM_DOCTOR_CACHE;
    delete process.env.REALM_DOCTOR_CACHE;
    try {
      expect(cacheRoot()).toBe(join(REPO, '.cache', 'realm-doctor'));
    } finally {
      if (saved !== undefined) process.env.REALM_DOCTOR_CACHE = saved;
    }
    const gitignore = readFileSync(join(REPO, '.gitignore'), 'utf8').split('\n');
    expect(gitignore).toEqual(expect.arrayContaining(['dw.json', '.env', '.cache/']));
  });

  it('no file tells the user to install anything globally', () => {
    const files = ['README.md', 'AGENTS.md', ...readdirSync(SKILLS).map((s) => join('.claude', 'skills', s, 'SKILL.md')), '.claude/reference/conventions.md'];
    for (const f of files) {
      const offending = readFileSync(join(REPO, f), 'utf8')
        .split('\n')
        .filter((l) => /npm (install|i) -g|--global/.test(l) && !/never/i.test(l));
      expect(offending, f).toEqual([]);
    }
  });
});

describe('skills', () => {
  const skills = readdirSync(SKILLS);

  it('ten skills, each with name, description and the shared conventions', () => {
    expect(skills.length).toBe(10);
    for (const s of skills) {
      const md = readFileSync(join(SKILLS, s, 'SKILL.md'), 'utf8');
      const fm = /^---\n([\s\S]*?)\n---/.exec(md)?.[1] ?? '';
      expect(fm).toContain(`name: ${s}`);
      expect(fm).toMatch(/description: .{40,}/);
      expect(md).toContain('../../reference/conventions.md');
    }
    for (const f of ['conventions.md', 'safety.md']) expect(existsSync(join(REPO, '.claude', 'reference', f))).toBe(true);
  });

  it('every realm-doctor command used by the skills exists', () => {
    const used = new Set<string>();
    for (const s of skills) {
      const md = readFileSync(join(SKILLS, s, 'SKILL.md'), 'utf8');
      for (const m of md.matchAll(/realm-doctor audit (\w+)/g)) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(5);
    const commands = readdirSync(join(REPO, 'cli-plugin', 'src', 'commands', 'audit')).map((f) => f.replace(/\.ts$/, ''));
    expect([...used].filter((c) => !commands.includes(c))).toEqual([]);
  });

  it('skills run tools through npx (local), never a bare global b2c', () => {
    for (const s of [...skills.map((x) => join(SKILLS, x, 'SKILL.md')), join(REPO, '.claude', 'reference', 'conventions.md')]) {
      const md = readFileSync(s, 'utf8');
      expect(md, s).not.toMatch(/`b2c (audit|job|code|setup|sites)/);
    }
  });
});

import {readFileSync, readdirSync, existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {FIXTURES} from './helpers.js';

const require = createRequire(import.meta.url);
const REPO = join(FIXTURES, '..', '..', '..');
const read = (p: string) => JSON.parse(readFileSync(join(REPO, p), 'utf8'));

describe('repository configuration', () => {
  it('config/dw.example.json is valid against the official dw.json schema', async () => {
    const {Validator} = await import('jsonschema');
    const schema = require('@salesforce/b2c-tooling-sdk/schemas/dw.schema.json');
    const result = new Validator().validate(read('config/dw.example.json'), schema);
    expect(result.errors.map((e) => e.stack)).toEqual([]);
  });

  it('every example instance is READ_ONLY and allows the search POSTs used by the audits', () => {
    const configs = read('config/dw.example.json').configs as Array<{name: string; safety: {level: string; rules: Array<{path: string}>}}>;
    const global = read('config/safety.example.json');
    for (const policy of [...configs.map((c) => c.safety), global]) {
      expect(policy.level).toBe('READ_ONLY');
      const paths = policy.rules.map((r: {path: string}) => r.path);
      expect(paths).toContain('/s/-/dw/data/*/sites/*/*_search');
      expect(paths).toContain('/s/-/dw/data/*/job_execution_search');
    }
  });

  it('the Claude plugin lists one SKILL.md per skill folder, each with name and description', () => {
    const skillsDir = join(REPO, 'plugins', 'realm-doctor', 'skills');
    const skills = readdirSync(skillsDir);
    expect(skills.length).toBe(10);
    for (const s of skills) {
      const md = readFileSync(join(skillsDir, s, 'SKILL.md'), 'utf8');
      const fm = /^---\n([\s\S]*?)\n---/.exec(md)?.[1] ?? '';
      expect(fm).toContain(`name: ${s}`);
      expect(fm).toMatch(/description: .{40,}/);
      // every skill points to the shared conventions, which must exist
      expect(md).toContain('../../reference/conventions.md');
    }
    expect(existsSync(join(REPO, 'plugins', 'realm-doctor', 'reference', 'conventions.md'))).toBe(true);
  });

  it('every b2c audit command used by the skills exists in the CLI plugin', () => {
    const skillsDir = join(REPO, 'plugins', 'realm-doctor', 'skills');
    const used = new Set<string>();
    for (const s of readdirSync(skillsDir)) {
      const md = readFileSync(join(skillsDir, s, 'SKILL.md'), 'utf8');
      for (const m of md.matchAll(/b2c audit (\w+)/g)) used.add(m[1]);
    }
    const commands = readdirSync(join(REPO, 'cli-plugin', 'src', 'commands', 'audit')).map((f) => f.replace(/\.ts$/, ''));
    expect([...used].filter((c) => !commands.includes(c))).toEqual([]);
  });

  it('the marketplace points to the plugin folder', () => {
    const m = read('.claude-plugin/marketplace.json');
    const p = read('plugins/realm-doctor/.claude-plugin/plugin.json');
    expect(m.plugins[0].source).toBe('./plugins/realm-doctor');
    expect(m.plugins[0].name).toBe(p.name);
    expect(m.plugins[0].version).toBe(p.version);
  });
});

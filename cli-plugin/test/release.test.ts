import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {allRules} from '../src/rules/index.js';
import {loadSettings} from '../src/lib/settings.js';
import {REPO} from './evals/harness.js';

const json = (file: string) => JSON.parse(readFileSync(join(REPO, file), 'utf8')) as Record<string, any>;

describe('docs', () => {
  const doc = readFileSync(join(REPO, 'docs', 'rules.md'), 'utf8');
  const ids = [...doc.matchAll(/^\| ((?:[A-Z]+)-\d{3}) \|/gm)].map((m) => m[1]);

  it('docs/rules.md lists every rule, and only real rules or MAN- findings of the skills', () => {
    const known = new Set(allRules().map((r) => r.id));
    for (const id of ids) expect(known.has(id) || id.startsWith('MAN-'), id).toBe(true);
    for (const id of known) expect(ids, id).toContain(id);
  });

  it('every MAN- id the skills use is documented', () => {
    const used = new Set<string>();
    for (const dir of readdirSync(join(REPO, '.claude', 'skills'))) for (const m of readFileSync(join(REPO, '.claude', 'skills', dir, 'SKILL.md'), 'utf8').matchAll(/MAN-\d{3}/g)) used.add(m[0]);
    for (const id of used) expect(ids, id).toContain(id);
  });
});

describe('release', () => {
  it('has one version everywhere (change it with `npm run set-version -- x.y.z`)', () => {
    const root = json('package.json').version;
    expect(json('cli-plugin/package.json').version).toBe(root);
    expect(json('plugin/.claude-plugin/plugin.json').version).toBe(root);
    expect(json('package-lock.json').version).toBe(root);
  });

  it('the plugin and the install commands run the tag of this version, not main', () => {
    const version = json('package.json').version;
    const spec = `github:m-devecchi/Realm-doctor#v${version}`;
    expect(json('plugin/.claude-plugin/plugin.json').mcpServers['realm-doctor'].args).toContain(spec);
    for (const file of ['README.md', 'docs/architecture.md', 'cli-plugin/src/commands/init.ts', 'cli-plugin/src/commands/install/copilot.ts']) {
      const specs = [...readFileSync(join(REPO, file), 'utf8').matchAll(/github:m-devecchi\/Realm-doctor(#v[\d.]+)?/g)].map((m) => m[0]);
      expect(specs.length, file).toBeGreaterThan(0);
      for (const s of specs) expect(s, file).toBe(spec);
    }
  });

  it('ships the security policy and the dependency updates config', () => {
    expect(existsSync(join(REPO, 'SECURITY.md'))).toBe(true);
    expect(readFileSync(join(REPO, '.github', 'dependabot.yml'), 'utf8')).toContain('@salesforce/*');
  });

  it('the example settings file is valid and every suppression has a reason', () => {
    const {settings, problems} = loadSettings(REPO, {REALM_DOCTOR_SETTINGS: join(REPO, 'config', 'realm-doctor.example.json')});
    expect(problems).toEqual([]);
    const all = [...(settings.suppress ?? []), ...Object.values(settings.realms ?? {}).flatMap((r) => r.suppress ?? [])];
    expect(all.length).toBeGreaterThan(0);
    for (const s of all) expect(s.reason?.trim(), JSON.stringify(s)).toBeTruthy();
  });
});

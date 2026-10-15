import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {loadSettings} from '../src/lib/settings.js';
import {REPO} from './evals/harness.js';

const json = (file: string) => JSON.parse(readFileSync(join(REPO, file), 'utf8')) as Record<string, any>;

describe('release', () => {
  it('has one version everywhere (change it with `npm run set-version -- x.y.z`)', () => {
    const root = json('package.json').version;
    expect(json('cli-plugin/package.json').version).toBe(root);
    expect(json('plugin/.claude-plugin/plugin.json').version).toBe(root);
    expect(json('package-lock.json').version).toBe(root);
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

/**
 * Static evals of the skills: what a skill tells the assistant to run must exist and be read-only.
 * They run on every skill in .claude/skills, so a new skill is checked without editing this file.
 */
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {beforeAll, describe, expect, it} from 'vitest';
import {createServer} from '../../src/commands/mcp.js';
import {allRules} from '../../src/rules/index.js';
import {REPO} from './harness.js';

const SKILLS_DIR = join(REPO, '.claude', 'skills');
const skills = readdirSync(SKILLS_DIR).map((name) => ({name, text: readFileSync(join(SKILLS_DIR, name, 'SKILL.md'), 'utf8')}));
const conventions = readFileSync(join(REPO, '.claude', 'reference', 'conventions.md'), 'utf8');

let tools: Array<{name: string; inputSchema: {properties?: Record<string, unknown>}}> = [];
beforeAll(async () => {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const server = createServer({projectDirectory: tmpdir()});
  const client = new Client({name: 'eval', version: '0'});
  await Promise.all([server.connect(a), client.connect(b)]);
  tools = (await client.listTools()).tools as typeof tools;
  await client.close();
});

const frontmatter = (text: string) => Object.fromEntries([...(/^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '').matchAll(/^(\w+):\s*(.*)$/gm)].map((m) => [m[1], m[2]]));
const READ_ONLY_VIOLATION = /(b2c\s+(code\s+(deploy|activate|delete|upload)|job\s+(run|import|export)|webdav\s+(put|delete|mkdir))|webdav_put|cartridge_deploy|mrt_bundle_push|\bdebug_\w+)/i;
const NEGATION = /\b(never|do not|don't|must not|no )\b/i;

describe.each(skills)('skill $name', ({name, text}) => {
  it('has a name equal to its folder and a description that says when to use it', () => {
    const fm = frontmatter(text);
    expect(fm.name).toBe(name);
    expect(fm.description?.length).toBeGreaterThan(60);
    expect(fm.description).toMatch(/Use when/i);
  });

  it('reads the shared conventions', () => {
    expect(text).toContain('../../reference/conventions.md');
  });

  it('only runs audit commands and flags that exist', async () => {
    for (const m of text.matchAll(/npx realm-doctor audit (\w+)([^`\n]*)/g)) {
      const file = join(REPO, 'cli-plugin', 'src', 'commands', 'audit', `${m[1]}.ts`);
      expect(existsSync(file), `audit ${m[1]}`).toBe(true);
      const command = (await import(file)).default as {flags: Record<string, {char?: string}>};
      const known = new Set(Object.entries(command.flags).flatMap(([k, v]) => [`--${k}`, v.char ? `-${v.char}` : '']));
      for (const flag of m[2].match(/(?<=\s)--?[a-z][a-z-]*/g) ?? []) expect(known.has(flag), `${m[1]} ${flag}`).toBe(true);
    }
  });

  it('only names MCP tools of the real server', () => {
    const names = new Set(tools.map((t) => t.name));
    const used = [...text.matchAll(/\b(audit_[a-z]+|list_(?:instances|rules|code_versions)|read_instance_file)\b/g)].map((m) => m[1]);
    for (const u of used) expect(names.has(u), u).toBe(true);
  });

  it('cites only existing rule ids', () => {
    const ids = new Set(allRules().map((r) => r.id));
    for (const m of text.matchAll(/\b(JS|ISML|HF|PROMO|ERR|QUOTA|JOB|FE)-\d{3}\b/g)) expect(ids.has(m[0]), m[0]).toBe(true);
  });

  it('never tells the assistant to write to an instance', () => {
    for (const line of text.split('\n').filter((l) => READ_ONLY_VIOLATION.test(l))) expect(NEGATION.test(line), line).toBe(true);
  });
});

describe('conventions', () => {
  it('every MCP tool and parameter in the command table exists on the server', () => {
    const byName = new Map(tools.map((t) => [t.name, Object.keys(t.inputSchema.properties ?? {})]));
    const rows = [...conventions.matchAll(/`((?:audit_|list_|read_)\w+)`(?: \(([^)]*)\))?/g)];
    expect(rows.length).toBeGreaterThan(6);
    for (const [, tool, params] of rows) {
      expect(byName.has(tool), tool).toBe(true);
      for (const p of [...(params ?? '').matchAll(/`(\w+)`/g)].map((x) => x[1])) expect(byName.get(tool), `${tool}.${p}`).toContain(p);
    }
  });

  it('documents the stable error codes and the suppression mechanism the tools use', () => {
    for (const code of ['AUTH_FAILED', 'NO_OCAPI', 'NOT_FOUND', 'BLOCKED_BY_SAFETY']) expect(conventions).toContain(code);
    expect(conventions).toContain('realm-doctor-ignore');
    expect(conventions).toContain('suppressed');
  });
});

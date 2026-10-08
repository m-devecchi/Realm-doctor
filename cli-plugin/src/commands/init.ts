import {Command, Flags, ux} from '@oclif/core';
import {copyFileSync, existsSync, mkdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join} from 'node:path';
import {PACKAGE_ROOT, resolveUserPath} from '../lib/distribution.js';

export default class Init extends Command {
  static description =
    'Creates a dw.json with example instances to fill in (never overwrites an existing file). Use it with the Claude Code plugin or the Copilot install, which have no repository folder.';
  static examples = ['npx github:m-devecchi/Realm-doctor init', 'npx github:m-devecchi/Realm-doctor init --path ~/work/sfcc/dw.json'];
  static flags = {
    path: Flags.string({description: 'Where to create the file (default ~/realm-doctor/dw.json)'}),
  };

  async run(): Promise<void> {
    const {flags} = await this.parse(Init);
    const target = resolveUserPath(flags.path ?? join(homedir(), 'realm-doctor', 'dw.json'));
    if (existsSync(target)) {
      ux.stdout(`${target} already exists: left unchanged.`);
      return;
    }
    mkdirSync(dirname(target), {recursive: true, mode: 0o700});
    copyFileSync(join(PACKAGE_ROOT, 'config', 'dw.example.json'), target);
    ux.stdout(`Created ${target}

Open it and replace the example instances with yours (name, hostname, client-id, client-secret).
Keep the "safety" block of every instance. Do not share this file: it holds your API client secrets.
How to create the API client: https://github.com/m-devecchi/Realm-doctor/blob/main/docs/salesforce-setup.md`);
  }
}

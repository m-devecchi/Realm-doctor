import {ux} from '@oclif/core';
import {BaseCommand} from '@salesforce/b2c-tooling-sdk/cli';
import {allRules} from '../../rules/index.js';


export default class AuditRules extends BaseCommand<typeof AuditRules> {
  static description = 'Lists every rule used by the realm-doctor audit commands.';
  static enableJsonFlag = true;
  static flags = {...BaseCommand.baseFlags};

  async run() {
    const rules = allRules();
    if (!this.jsonEnabled()) for (const r of rules) ux.stdout(`${r.id.padEnd(10)} ${r.severity.padEnd(16)} ${r.title}`);
    return {rules};
  }
}

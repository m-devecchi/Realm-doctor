import {ux} from '@oclif/core';
import {BaseCommand} from '@salesforce/b2c-tooling-sdk/cli';
import {RULES} from '../../rules/index.js';

const OTHER = [
  {id: 'ERR-001', severity: 'medium..critical', title: 'New error on the evaluated day'},
  {id: 'ERR-002', severity: 'high/critical', title: 'Error spike (>= 3x the average of previous days)'},
  {id: 'ERR-003', severity: 'medium/critical', title: 'High-volume recurring error'},
  {id: 'QUOTA-001', severity: 'critical', title: 'Enforced quota limit exceeded'},
  {id: 'QUOTA-002', severity: 'high', title: 'Non-enforced quota limit exceeded'},
  {id: 'QUOTA-003', severity: 'medium/high', title: 'Warning threshold exceeded (high above 80% of the limit)'},
  {id: 'FE-001', severity: 'medium/high', title: 'LCP above 2.5 s'},
  {id: 'FE-002', severity: 'medium/high', title: 'CLS above 0.1'},
  {id: 'FE-003', severity: 'medium/high', title: 'INP above 200 ms'},
  {id: 'FE-004', severity: 'medium/high', title: 'Total Blocking Time above 200 ms (lab only)'},
  {id: 'FE-005', severity: 'low/medium', title: 'JavaScript above 1 MB or page above 3 MB'},
  {id: 'FE-006', severity: 'medium', title: 'Third parties blocking the main thread above 250 ms'},
  {id: 'FE-007', severity: 'medium', title: 'Browser console errors'},
];

export default class AuditRules extends BaseCommand<typeof AuditRules> {
  static description = 'Lists every rule used by the realm-doctor audit commands.';
  static enableJsonFlag = true;
  static flags = {...BaseCommand.baseFlags};

  async run() {
    const rules = [...OTHER, ...RULES];
    if (!this.jsonEnabled()) for (const r of rules) ux.stdout(`${r.id.padEnd(10)} ${r.severity.padEnd(16)} ${r.title}`);
    return {rules};
  }
}

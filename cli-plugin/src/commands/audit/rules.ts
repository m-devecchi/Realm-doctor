import {ux} from '@oclif/core';
import {BaseCommand} from '@salesforce/b2c-tooling-sdk/cli';
import {RULES} from '../../rules/index.js';

const OTHER = [
  {id: 'ERR-001', severity: 'medium..critical', title: 'Nuovo errore nel giorno valutato'},
  {id: 'ERR-002', severity: 'high/critical', title: 'Picco di errori (>= 3x la media dei giorni precedenti)'},
  {id: 'ERR-003', severity: 'medium/critical', title: 'Errore ricorrente ad alto volume'},
  {id: 'QUOTA-001', severity: 'critical', title: 'Limite di quota enforced superato'},
  {id: 'QUOTA-002', severity: 'high', title: 'Limite di quota non enforced superato'},
  {id: 'QUOTA-003', severity: 'medium/high', title: 'Soglia di warning superata (high oltre l\'80% del limite)'},
  {id: 'FE-001', severity: 'medium/high', title: 'LCP oltre 2,5 s'},
  {id: 'FE-002', severity: 'medium/high', title: 'CLS oltre 0,1'},
  {id: 'FE-003', severity: 'medium/high', title: 'INP oltre 200 ms'},
  {id: 'FE-004', severity: 'medium/high', title: 'Total Blocking Time oltre 200 ms (solo lab)'},
  {id: 'FE-005', severity: 'low/medium', title: 'JavaScript oltre 1 MB o pagina oltre 3 MB'},
  {id: 'FE-006', severity: 'medium', title: 'Terze parti che bloccano il thread oltre 250 ms'},
  {id: 'FE-007', severity: 'medium', title: 'Errori nella console del browser'},
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

import {Flags, ux} from '@oclif/core';
import {BaseCommand} from '@salesforce/b2c-tooling-sdk/cli';
import {readFile} from 'node:fs/promises';
import {auditFrontend} from '../../lib/audits.js';
import type {PsiResult} from '../../lib/frontend.js';
import {formatReport} from '../../lib/report.js';

export default class AuditFrontend extends BaseCommand<typeof AuditFrontend> {
  static description =
    'Runs PageSpeed Insights on storefront URLs and reports Core Web Vitals, heavy JavaScript, blocking third parties and console errors. Optional API key in PSI_API_KEY.';
  static enableJsonFlag = true;
  static examples = ['<%= config.bin %> <%= command.id %> --url https://www.example.com/ --url https://www.example.com/c/shoes --json'];
  static flags = {
    ...BaseCommand.baseFlags,
    url: Flags.string({description: 'Page URL, repeatable', multiple: true, required: true}),
    strategy: Flags.string({description: 'Device', options: ['mobile', 'desktop'], default: 'mobile'}),
    'psi-file': Flags.string({description: 'Analyze a saved PSI JSON response instead of calling the API (single URL)'}),
  };

  async run() {
    const psi = this.flags['psi-file'] ? (JSON.parse(await readFile(this.flags['psi-file'], 'utf8')) as PsiResult) : undefined;
    const report = await auditFrontend({urls: this.flags.url, strategy: this.flags.strategy as 'mobile' | 'desktop', psi});
    if (!this.jsonEnabled()) ux.stdout(formatReport(report));
    return report;
  }
}

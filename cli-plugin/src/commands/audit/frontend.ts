import {Flags, ux} from '@oclif/core';
import {BaseCommand} from '@salesforce/b2c-tooling-sdk/cli';
import {frontendFindings, summarizePsi, type FrontendSummary, type PsiResult} from '../../lib/frontend.js';
import {type Finding} from '../../lib/finding.js';
import {buildReport, formatReport} from '../../lib/report.js';

const PSI = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

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
    const summaries: FrontendSummary[] = [];
    const findings: Finding[] = [];
    const notes: string[] = [];
    for (const url of this.flags.url) {
      let psi: PsiResult;
      if (this.flags['psi-file']) {
        const {readFile} = await import('node:fs/promises');
        psi = JSON.parse(await readFile(this.flags['psi-file'], 'utf8')) as PsiResult;
      } else {
        const q = new URLSearchParams({url, strategy: this.flags.strategy, category: 'performance'});
        if (process.env.PSI_API_KEY) q.set('key', process.env.PSI_API_KEY);
        const res = await fetch(`${PSI}?${q}`);
        if (!res.ok) {
          notes.push(`PageSpeed Insights non disponibile per ${url}: HTTP ${res.status}`);
          continue;
        }
        psi = (await res.json()) as PsiResult;
      }
      const s = summarizePsi(url, psi);
      summaries.push(s);
      findings.push(...frontendFindings(s));
    }
    const report = buildReport('audit frontend', {urls: this.flags.url, strategy: this.flags.strategy}, findings, {pages: summaries}, notes);
    if (!this.jsonEnabled()) ux.stdout(formatReport(report));
    return report;
  }
}

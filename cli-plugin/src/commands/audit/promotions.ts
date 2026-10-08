import {Flags, ux} from '@oclif/core';
import {InstanceCommand} from '@salesforce/b2c-tooling-sdk/cli';
import {readFile, writeFile} from 'node:fs/promises';
import {buildReport, formatReport} from '../../lib/report.js';
import {fetchPromoBundle} from '../../lib/sfcc.js';
import {analyzePromotions, type PromoBundle} from '../../rules/promo-rules.js';

export default class AuditPromotions extends InstanceCommand<typeof AuditPromotions> {
  static description =
    'Reads promotions, campaigns, assignments, coupons and customer groups of a site through OCAPI (read-only searches) and reports promotions that can never fire, conflicts and broken qualifiers.';
  static enableJsonFlag = true;
  static examples = [
    '<%= config.bin %> <%= command.id %> --site RefArch --currency EUR --json',
    '<%= config.bin %> <%= command.id %> --site RefArch --save promo-bundle.json',
    '<%= config.bin %> <%= command.id %> --input promo-bundle.json --json',
  ];
  static flags = {
    ...InstanceCommand.baseFlags,
    site: Flags.string({description: 'Site ID (e.g. RefArch)'}),
    currency: Flags.string({description: 'Site currency, repeatable (enables the currency check)', multiple: true}),
    now: Flags.string({description: 'Reference date-time for "active" (ISO). Default: now'}),
    input: Flags.string({description: 'Analyze a saved bundle instead of calling the instance'}),
    save: Flags.string({description: 'Save the fetched bundle to this JSON file'}),
  };

  async run() {
    let bundle: PromoBundle;
    if (this.flags.input) {
      bundle = JSON.parse(await readFile(this.flags.input, 'utf8')) as PromoBundle;
    } else {
      if (!this.flags.site) this.error('Indicare --site oppure --input.');
      this.requireServer();
      bundle = await fetchPromoBundle(this.instance, this.flags.site, this.flags.currency);
      if (this.flags.save) await writeFile(this.flags.save, JSON.stringify(bundle, null, 2), {mode: 0o600});
    }
    if (this.flags.now) bundle.now = this.flags.now;
    if (this.flags.currency?.length) bundle.currencies = this.flags.currency;

    const findings = analyzePromotions(bundle);
    const notes = [
      'Qualificatori di prodotto e regole di sconto non sono esposti dalle API: verificarli con carrelli di prova (skill promo-audit).',
    ];
    if (!bundle.currencies?.length) notes.push('Controllo valuta saltato: indicare --currency.');
    const report = buildReport(
      'audit promotions',
      {site: bundle.site, now: bundle.now},
      findings,
      {
        counts: {
          promotions: bundle.promotions.length,
          campaigns: bundle.campaigns.length,
          assignments: bundle.assignments.length,
          coupons: bundle.coupons.length,
          customerGroups: bundle.customerGroups.length,
        },
      },
      notes,
    );
    if (!this.jsonEnabled()) ux.stdout(formatReport(report));
    return report;
  }
}

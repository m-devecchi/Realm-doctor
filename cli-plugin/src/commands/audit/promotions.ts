import {Flags, ux} from '@oclif/core';
import {InstanceCommand} from '@salesforce/b2c-tooling-sdk/cli';
import {readFile, writeFile} from 'node:fs/promises';
import {auditPromotions} from '../../lib/audits.js';
import {formatReport} from '../../lib/report.js';
import type {PromoBundle} from '../../rules/promo-rules.js';

export default class AuditPromotions extends InstanceCommand<typeof AuditPromotions> {
  static description =
    'Reads promotions, campaigns, assignments, coupons and customer groups of a site through OCAPI (read-only searches) and reports promotions that can never fire, conflicts and broken qualifiers.';
  static enableJsonFlag = true;
  static examples = [
    '<%= config.bin %> <%= command.id %> -i acme-prd --site RefArch --currency EUR --json',
    '<%= config.bin %> <%= command.id %> -i acme-prd --site RefArch --save promo-bundle.json',
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
    if (!this.flags.input && !this.flags.site) this.error('Pass --site or --input.');
    const input = this.flags.input ? (JSON.parse(await readFile(this.flags.input, 'utf8')) as PromoBundle) : undefined;
    const {report, bundle} = await auditPromotions(
      () => {
        this.requireServer();
        return {instance: this.instance, hostname: this.resolvedConfig.values.hostname!};
      },
      {site: this.flags.site, currencies: this.flags.currency, now: this.flags.now, bundle: input},
    );
    if (this.flags.save && !input) await writeFile(this.flags.save, JSON.stringify(bundle, null, 2), {mode: 0o600});
    if (!this.jsonEnabled()) ux.stdout(formatReport(report));
    return report;
  }
}

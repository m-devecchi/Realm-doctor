import {Flags, ux} from '@oclif/core';
import {InstanceCommand} from '@salesforce/b2c-tooling-sdk/cli';
import {auditHyperforce} from '../../lib/audits.js';
import {formatReport} from '../../lib/report.js';

export default class AuditHyperforce extends InstanceCommand<typeof AuditHyperforce> {
  static description =
    'Hyperforce readiness checks on cartridge code and configuration files: hardcoded IP addresses and instance hostnames. Reads the code version via WebDAV (read-only) or a local folder.';
  static enableJsonFlag = true;
  static examples = ['<%= config.bin %> <%= command.id %> -i acme-prd --json', '<%= config.bin %> <%= command.id %> --dir ./cartridges --json'];
  static flags = {
    ...InstanceCommand.baseFlags,
    dir: Flags.string({description: 'Analyze a local folder instead of the instance'}),
    cartridge: Flags.string({description: 'Only these cartridges', multiple: true}),
    'include-base': Flags.boolean({description: 'Also analyze app_storefront_base, modules and bm_* (default: custom cartridges only)', default: false}),
  };

  async run() {
    const report = await auditHyperforce(
      () => {
        this.requireServer();
        this.requireWebDavCredentials();
        return {instance: this.instance, hostname: this.resolvedConfig.values.hostname!, instanceName: this.resolvedConfig.values.instanceName};
      },
      {dir: this.flags.dir, codeVersion: this.flags['code-version'], cartridges: this.flags.cartridge, includeBase: this.flags['include-base']},
    );
    if (!this.jsonEnabled()) ux.stdout(formatReport(report));
    return report;
  }
}

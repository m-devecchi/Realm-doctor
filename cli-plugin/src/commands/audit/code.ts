import {Flags, ux} from '@oclif/core';
import {InstanceCommand} from '@salesforce/b2c-tooling-sdk/cli';
import {auditCode} from '../../lib/audits.js';
import {formatReport} from '../../lib/report.js';

export default class AuditCode extends InstanceCommand<typeof AuditCode> {
  static description =
    'Static analysis of cartridge code (JS and ISML): expensive calls in loops, unclosed iterators, large transactions, secrets, unencoded output. Reads the active code version via WebDAV (read-only) or a local folder with --dir.';
  static enableJsonFlag = true;
  static examples = [
    '<%= config.bin %> <%= command.id %> -i acme-prd --json',
    '<%= config.bin %> <%= command.id %> -i acme-prd --cartridge app_custom --json',
    '<%= config.bin %> <%= command.id %> --dir ./cartridges --json',
  ];
  static flags = {
    ...InstanceCommand.baseFlags,
    dir: Flags.string({description: 'Analyze a local folder instead of the instance'}),
    cartridge: Flags.string({description: 'Only these cartridges', multiple: true}),
    'max-findings': Flags.integer({description: 'Maximum findings returned', default: 500}),
  };

  async run() {
    const report = await auditCode(
      () => {
        this.requireServer();
        this.requireWebDavCredentials();
        return {instance: this.instance, hostname: this.resolvedConfig.values.hostname!};
      },
      {dir: this.flags.dir, codeVersion: this.flags['code-version'], cartridges: this.flags.cartridge, maxFindings: this.flags['max-findings']},
    );
    if (!this.jsonEnabled()) ux.stdout(formatReport(report));
    return report;
  }
}

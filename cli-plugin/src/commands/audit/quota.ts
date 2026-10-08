import {Flags, ux} from '@oclif/core';
import {InstanceCommand} from '@salesforce/b2c-tooling-sdk/cli';
import {auditQuota} from '../../lib/audits.js';
import {formatReport} from '../../lib/report.js';

export default class AuditQuota extends InstanceCommand<typeof AuditQuota> {
  static description = 'Reads quota logs (read-only) and reports quota limits and warning thresholds exceeded, per quota and code location.';
  static enableJsonFlag = true;
  static examples = ['<%= config.bin %> <%= command.id %> -i acme-prd --since 7d --json'];
  static flags = {
    ...InstanceCommand.baseFlags,
    since: Flags.string({description: 'Period start: 24h, 7d or ISO date-time', default: '7d'}),
    prefix: Flags.string({description: 'Log prefixes to scan for quota messages', multiple: true, default: ['quota']}),
    'max-files': Flags.integer({description: 'Maximum log files to read (newest first)', default: 200}),
    'max-kb': Flags.integer({description: 'Read at most this many KB from the end of each file', default: 20_480}),
  };

  async run() {
    this.requireServer();
    this.requireWebDavCredentials();
    const report = await auditQuota(
      {instance: this.instance, hostname: this.resolvedConfig.values.hostname!},
      {since: this.flags.since, prefixes: this.flags.prefix, maxFiles: this.flags['max-files'], maxKb: this.flags['max-kb']},
    );
    if (!this.jsonEnabled()) ux.stdout(formatReport(report));
    return report;
  }
}

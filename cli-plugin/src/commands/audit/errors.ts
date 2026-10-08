import {Flags, ux} from '@oclif/core';
import {InstanceCommand} from '@salesforce/b2c-tooling-sdk/cli';
import {auditErrors} from '../../lib/audits.js';
import {formatReport} from '../../lib/report.js';

export default class AuditErrors extends InstanceCommand<typeof AuditErrors> {
  static description =
    'Downloads error logs (read-only), groups entries by signature and reports new errors, spikes and top recurring errors. Personal data is masked before caching or output.';
  static enableJsonFlag = true;
  static examples = [
    '<%= config.bin %> <%= command.id %> -i acme-prd --since 7d --json',
    '<%= config.bin %> <%= command.id %> -i acme-prd --since 2026-10-01T00:00:00Z --prefix error --prefix customerror',
  ];
  static flags = {
    ...InstanceCommand.baseFlags,
    since: Flags.string({description: 'Period start: 24h, 7d or ISO date-time', default: '24h'}),
    prefix: Flags.string({description: 'Log prefixes', multiple: true, default: ['error', 'customerror', 'fatal']}),
    day: Flags.string({description: 'Day to evaluate for new errors and spikes (YYYY-MM-DD, default: last day in the data)'}),
    top: Flags.integer({description: 'Number of signatures returned in data', default: 30}),
    'max-files': Flags.integer({description: 'Maximum log files to read (newest first)', default: 200}),
    'max-kb': Flags.integer({description: 'Read at most this many KB from the end of each file', default: 20_480}),
  };

  async run() {
    this.requireServer();
    this.requireWebDavCredentials();
    const report = await auditErrors(
      {instance: this.instance, hostname: this.resolvedConfig.values.hostname!},
      {since: this.flags.since, prefixes: this.flags.prefix, day: this.flags.day, top: this.flags.top, maxFiles: this.flags['max-files'], maxKb: this.flags['max-kb']},
    );
    if (!this.jsonEnabled()) ux.stdout(formatReport(report));
    return report;
  }
}

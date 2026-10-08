import {Flags, ux} from '@oclif/core';
import {InstanceCommand} from '@salesforce/b2c-tooling-sdk/cli';
import {parseSinceTime} from '@salesforce/b2c-tooling-sdk/operations/logs';
import {aggregateErrors, errorFindings} from '../../lib/errors.js';
import {buildReport, formatReport} from '../../lib/report.js';
import {fetchLogEntries} from '../../lib/sfcc.js';

export default class AuditErrors extends InstanceCommand<typeof AuditErrors> {
  static description =
    'Downloads error logs (read-only), groups entries by signature and reports new errors, spikes and top recurring errors. Personal data is masked before caching or output.';
  static enableJsonFlag = true;
  static examples = [
    '<%= config.bin %> <%= command.id %> --since 7d --json',
    '<%= config.bin %> <%= command.id %> --since 2026-10-01T00:00:00Z --prefix error --prefix customerror',
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
    const hostname = this.resolvedConfig.values.hostname!;
    const since = parseSinceTime(this.flags.since);

    const {entries, files} = await fetchLogEntries(this.instance, hostname, {
      prefixes: this.flags.prefix,
      since,
      maxFiles: this.flags['max-files'],
      maxBytesPerFile: this.flags['max-kb'] * 1024,
    });
    const signatures = aggregateErrors(entries, {since: since.toISOString()});
    const findings = errorFindings(signatures, {day: this.flags.day});
    const notes: string[] = [];
    if (files.length === 0) notes.push('Nessun file di log nel periodo per i prefissi indicati.');
    const truncated = files.filter((f) => f.truncated).length;
    if (truncated) notes.push(`${truncated} file letti solo in coda (oltre ${this.flags['max-kb']} KB).`);

    const report = buildReport(
      'audit errors',
      {hostname, since: since.toISOString(), prefixes: this.flags.prefix},
      findings,
      {files: files.length, entries: entries.length, signatures: signatures.slice(0, this.flags.top)},
      notes,
    );
    if (!this.jsonEnabled()) ux.stdout(formatReport(report));
    return report;
  }
}

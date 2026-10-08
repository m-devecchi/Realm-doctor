import {Flags, ux} from '@oclif/core';
import {InstanceCommand} from '@salesforce/b2c-tooling-sdk/cli';
import {parseSinceTime} from '@salesforce/b2c-tooling-sdk/operations/logs';
import {aggregateQuota, parseQuotaEvent, quotaFindings, type QuotaEvent} from '../../lib/quota.js';
import {buildReport, formatReport} from '../../lib/report.js';
import {fetchLogEntries} from '../../lib/sfcc.js';

export default class AuditQuota extends InstanceCommand<typeof AuditQuota> {
  static description = 'Reads quota logs (read-only) and reports quota limits and warning thresholds exceeded, per quota and code location.';
  static enableJsonFlag = true;
  static examples = ['<%= config.bin %> <%= command.id %> --since 7d --json'];
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
    const hostname = this.resolvedConfig.values.hostname!;
    const since = parseSinceTime(this.flags.since);
    const {entries, files} = await fetchLogEntries(this.instance, hostname, {
      prefixes: this.flags.prefix,
      since,
      maxFiles: this.flags['max-files'],
      maxBytesPerFile: this.flags['max-kb'] * 1024,
    });
    const events = entries
      .filter((e) => !e.timestamp || Date.parse(e.timestamp) >= since.getTime())
      .map(parseQuotaEvent)
      .filter((e): e is QuotaEvent => e !== undefined);
    const summaries = aggregateQuota(events);
    const notes = files.length === 0 ? ['Nessun file di quota nel periodo: nessuna violazione registrata o permessi WebDAV mancanti su /Logs.'] : [];
    const report = buildReport('audit quota', {hostname, since: since.toISOString()}, quotaFindings(summaries), {files: files.length, events: events.length, quotas: summaries}, notes);
    if (!this.jsonEnabled()) ux.stdout(formatReport(report));
    return report;
  }
}

import {Flags, ux} from '@oclif/core';
import {InstanceCommand} from '@salesforce/b2c-tooling-sdk/cli';
import {auditJobs} from '../../lib/audits.js';
import {formatReport} from '../../lib/report.js';

export default class AuditJobs extends InstanceCommand<typeof AuditJobs> {
  static description =
    'Reads recent job executions (read-only OCAPI job_execution_search) and reports failing, slow, stuck and overlapping jobs.';
  static enableJsonFlag = true;
  static examples = ['<%= config.bin %> <%= command.id %> -i acme-prd --json', '<%= config.bin %> <%= command.id %> -i acme-prd --job-id ExportOrders --json'];
  static flags = {
    ...InstanceCommand.baseFlags,
    'job-id': Flags.string({description: 'Only this job'}),
    count: Flags.integer({description: 'Number of most recent executions to read (max 200)', default: 100}),
  };

  async run() {
    this.requireServer();
    this.requireOAuthCredentials();
    const report = await auditJobs({instance: this.instance, hostname: this.resolvedConfig.values.hostname!}, {jobId: this.flags['job-id'], count: this.flags.count});
    if (!this.jsonEnabled()) ux.stdout(formatReport(report));
    return report;
  }
}

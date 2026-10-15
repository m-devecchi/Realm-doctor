import {Args, Command, ux} from '@oclif/core';
import {readFileSync} from 'node:fs';
import {diffReports} from '../../lib/diff.js';
import type {Report} from '../../lib/report.js';

export default class AuditDiff extends Command {
  static description = 'Compares two saved JSON reports of the same audit: new, fixed, still open and severity changes (by finding fingerprint).';
  static enableJsonFlag = true;
  static examples = ['<%= config.bin %> <%= command.id %> last-week.json this-week.json --json'];
  static args = {
    before: Args.string({description: 'Older report (JSON from --json)', required: true}),
    after: Args.string({description: 'Newer report (JSON from --json)', required: true}),
  };

  async run() {
    const {args} = await this.parse(AuditDiff);
    const read = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as Report;
    const diff = diffReports(read(args.before), read(args.after));
    if (!this.jsonEnabled()) {
      ux.stdout(`${diff.command}: ${diff.new.length} new, ${diff.fixed.length} fixed, ${diff.unchanged.length} unchanged, ${diff.severityChanged.length} changed severity`);
      for (const f of diff.new) ux.stdout(`  NEW   [${f.severity}] ${f.rule} ${f.title}`);
      for (const f of diff.fixed) ux.stdout(`  FIXED [${f.severity}] ${f.rule} ${f.title}`);
      for (const n of diff.notes) ux.stdout(`Note: ${n}`);
    }
    return diff;
  }
}

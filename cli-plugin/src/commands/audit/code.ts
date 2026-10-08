import {Flags, ux} from '@oclif/core';
import {InstanceCommand} from '@salesforce/b2c-tooling-sdk/cli';
import {loadCode} from '../../lib/code-source.js';
import {buildReport, formatReport} from '../../lib/report.js';
import {analyzeCode} from '../../rules/index.js';

export default class AuditCode extends InstanceCommand<typeof AuditCode> {
  static description =
    'Static analysis of cartridge code (JS and ISML): expensive calls in loops, unclosed iterators, large transactions, secrets, unencoded output. Reads the active code version via WebDAV (read-only) or a local folder with --dir.';
  static enableJsonFlag = true;
  static examples = [
    '<%= config.bin %> <%= command.id %> --json',
    '<%= config.bin %> <%= command.id %> --cartridge app_custom --json',
    '<%= config.bin %> <%= command.id %> --dir ./cartridges --json',
  ];
  static flags = {
    ...InstanceCommand.baseFlags,
    dir: Flags.string({description: 'Analyze a local folder instead of the instance'}),
    cartridge: Flags.string({description: 'Only these cartridges', multiple: true}),
    'max-findings': Flags.integer({description: 'Maximum findings returned', default: 500}),
  };

  async run() {
    const code = await loadCode(
      {dir: this.flags.dir, codeVersion: this.flags['code-version'], cartridges: this.flags.cartridge},
      () => {
        this.requireServer();
        this.requireWebDavCredentials();
        return {instance: this.instance, hostname: this.resolvedConfig.values.hostname!};
      },
    );
    const all = analyzeCode(code.files);
    const findings = all.slice(0, this.flags['max-findings']);
    const notes = [...code.notes];
    if (all.length > findings.length) notes.push(`Mostrati ${findings.length} finding su ${all.length}.`);
    const report = buildReport(
      'audit code',
      {origin: code.origin, codeVersion: code.codeVersion, dir: code.root, cartridges: this.flags.cartridge},
      findings,
      {files: code.files.length, totalFindings: all.length},
      notes,
    );
    if (!this.jsonEnabled()) ux.stdout(formatReport(report));
    return report;
  }
}

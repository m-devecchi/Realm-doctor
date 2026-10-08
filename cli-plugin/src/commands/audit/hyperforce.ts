import {Flags, ux} from '@oclif/core';
import {InstanceCommand} from '@salesforce/b2c-tooling-sdk/cli';
import {loadCode} from '../../lib/code-source.js';
import {buildReport, formatReport} from '../../lib/report.js';
import {analyzeHyperforceReadiness} from '../../rules/index.js';

export default class AuditHyperforce extends InstanceCommand<typeof AuditHyperforce> {
  static description =
    'Hyperforce readiness checks on cartridge code and configuration files: hardcoded IP addresses and instance hostnames. Reads the code version via WebDAV (read-only) or a local folder.';
  static enableJsonFlag = true;
  static examples = ['<%= config.bin %> <%= command.id %> --json', '<%= config.bin %> <%= command.id %> --dir ./cartridges --json'];
  static flags = {
    ...InstanceCommand.baseFlags,
    dir: Flags.string({description: 'Analyze a local folder instead of the instance'}),
    cartridge: Flags.string({description: 'Only these cartridges', multiple: true}),
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
    const findings = analyzeHyperforceReadiness(code.files);
    const checklist = [
      {item: 'Hardcoded IPs in code', status: findings.some((f) => f.rule === 'HF-001') ? 'FAIL' : 'OK'},
      {item: 'Hardcoded instance hostnames', status: findings.some((f) => f.rule === 'HF-002') ? 'FAIL' : 'OK'},
      {item: 'IP allowlists on external systems (ERP, PSP, OMS, WAF)', status: 'TO CHECK', note: 'Cannot be verified from code: ask the vendors.'},
      {item: 'Integrations calling SFCC with fixed IPs or hosts', status: 'TO CHECK', note: 'List the inbound systems.'},
      {item: 'mTLS certificates and services in Business Manager', status: 'TO CHECK', note: 'Check the endpoints of the configured services.'},
    ];
    const report = buildReport('audit hyperforce', {origin: code.origin, codeVersion: code.codeVersion, dir: code.root}, findings, {files: code.files.length, checklist}, code.notes);
    if (!this.jsonEnabled()) ux.stdout(formatReport(report));
    return report;
  }
}
